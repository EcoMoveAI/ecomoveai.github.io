# EcoMove AI — Emission Methodology, Data Provenance and Limitations

*Methodology version: factor sets `ecomove-tw-hybrid` v2026.10-1 and `desnz-2025-uk` v2025.1 · calculation engine `calc-1.0.0` · sources checked 2026-10-10.*

This document explains exactly how EcoMove AI turns a recorded trip into a CO₂e estimate, where every emission factor comes from, and what the numbers can and cannot tell you. The same information is shown to users in the app (**Profile → Methodology & sources** and on every trip's detail screen).

> **Design principle.** Transparent and reproducible calculations take priority over apparent precision. A mode without a verifiable factor is reported as **unavailable**, never guessed. The AI assistant never calculates emissions; it calls the deterministic engine described here.

---

## 1. Calculation

The engine lives in [`supabase/functions/_shared/core/calc.ts`](../supabase/functions/_shared/core/calc.ts). It is a pure, unit-tested function shared by the app, the server and the AI tools.

| Factor unit | Formula | Used for |
|---|---|---|
| `kgCO2e/pkm` (per passenger-km) | `emissions = distance_km × factor` | bus, MRT/metro, rail, HSR, taxi, walking, cycling |
| `kgCO2e/vkm` (per vehicle-km) | `emissions = distance_km × factor ÷ occupants` | private car, motorcycle/scooter |

* **Occupancy.** Vehicle-km factors describe the whole vehicle. The user's share is divided equally among the people in the vehicle, including the user. The default is **1** (driver alone), which is configurable in Preferences and per trip. If occupancy is missing, the engine assumes 1 and records a warning.
* **Taxi** uses DESNZ's passenger-km factor, which already applies DESNZ's own average taxi occupancy, so no further division is made.
* **Validation.** Distances must be finite, ≥ 0 and ≤ 1,500 km (long-distance flights and voyages are out of scope). Occupancy must be an integer from 1 to 9. Units other than `kgCO2e/pkm` or `kgCO2e/vkm` are rejected.
* **Precision.** Values are stored at full floating-point precision and rounded only for display (`< 1 kg` → grams; `< 100 kg` → 2 decimals).
* **Missing factors.** `unknown` and `other_public` have no factor. Such trips are saved with `calc_status = factor_unavailable`; their distance counts, but their emissions are **excluded** from totals, and every report states how many trips were excluded.
* **Snapshot per trip.** Each trip stores `factor_id`, `factor_value`, `factor_unit`, `boundary`, `factor_set_id`, `factor_set_version`, `calc_method`, `calc_engine_version`, `occupancy_applied` and `calculated_at`. Historical reports therefore stay reproducible even after factors change.
* **Recalculation is explicit.** Editing a trip's distance, mode, variant or occupancy recalculates it with the current methodology. Switching methodology prompts the user to recalculate all trips. Otherwise old trips keep their original snapshot, and the app shows which trips were calculated with a different version.

## 2. Accounting boundaries

| Boundary code | Meaning | Sources using it |
|---|---|---|
| `direct_operational` | Tailpipe/combustion emissions only. Excludes well-to-tank fuel production and vehicle manufacture. | DESNZ car, motorcycle, taxi, bus |
| `operational_incl_electricity` | Operational emissions including power-station emissions for electric traction. | DESNZ rail, underground, light rail, BEV |
| `lifecycle_product_cfp` | Product carbon footprint of a passenger-transport service (ISO 14067-style), covering several life-cycle stages, e.g. station operations, materials and end-of-life. | Taiwan carbon-label values (Taipei Metro, THSR, TRA) |
| `zero_direct_convention` | Human-powered travel recorded as 0 direct emissions. **This does not mean zero life-cycle emissions** (bicycle manufacture, infrastructure and food energy are excluded). | Walking, cycling |

DESNZ `direct` and `incl. electricity` factors follow one consistent operational convention and are treated as comparable. Life-cycle carbon-label values are **not** directly comparable with operational factors. Whenever a total, comparison or mode comparison mixes them, the app shows a warning.

**Direction of the bias in the Taiwan-first set.** Rail and MRT values there are life-cycle footprints, while road values are tailpipe-only. Because the rail figures include more stages, rail looks relatively *worse* than it would in a like-for-like comparison. Recommendations to shift from road to rail are therefore **conservative**: they understate rather than overstate the benefit.

## 3. Factor sets

Users choose one of two methodologies (Profile → Methodology):

1. **Taiwan-first (mixed boundary)** — `ecomove-tw-hybrid` v2026.10-1 *(default)*. Official Taiwanese carbon-label values for MRT, TRA and THSR. UK DESNZ 2025 values serve as clearly labelled **regional proxies** for car, motorcycle, taxi and bus, because no official Taiwanese per-km factor for those modes could be verified (see §5).
2. **DESNZ 2025 (consistent boundary)** — `desnz-2025-uk` v2025.1. Every factor comes from one official dataset with one boundary convention. Best for like-for-like comparisons between modes, but it reflects UK fleets, load factors and the UK grid.

## 4. Factor register

### 4.1 Taiwan carbon-footprint label values (life-cycle, per passenger-km)

| Factor ID | Mode / variant | Value (kg CO₂e/pkm) | Source and evidence | Quality |
|---|---|---|---|---|
| `twcfp-taipei-metro-2024-pkm` | MRT — Taipei Metro | **0.075** | Taipei Rapid Transit Corp., [旅客運輸服務碳足跡](https://www.metro.taipei/cp.aspx?n=5B7ACD566D2CB1DD): about 75 g CO₂e/pkm for inventory year 2024 (about 30 g vehicle operation + about 45 g station services; 2023: about 78 g). Label effective 2025-10-05. Confirmed by a [Taipei City Government press release, 2025-10-17](https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=C09930BF8D294E3E). | Official, primary |
| `twcfp-thsr-2025-pkm` | High-speed rail — THSR | **0.029** | Taiwan High Speed Rail, [環境永續－高速鐵路旅客運輸服務碳足跡](https://www.thsrc.com.tw/ArticleContent/5a1f4c72-b564-4706-bcdd-efbda93c3d93): certificate 碳標字第2014910001-01號, 29 g CO₂e/pkm, valid 2025-12-17 to 2027-12-16. MOENV approval letter 環部授氣字第1149115244號 (2025-12-09). Earlier labels: 38 g (2014), 32 g (2020–2025). | Official, primary |
| `twcfp-tra-local-2025-pkm` | Train — TRA Local/Local Express (區間/區間快) *(default train variant)* | **0.055** | TRA carbon-footprint labels approved by MOENV on 2025-06-25 (verification statement 2025-03-27), reported by [Reccessary, 2025-08-06](https://www.reccessary.com/zh-tw/news/taiwan-railway-gets-carbon-footprint-label) and Commercial Times (ctee.com.tw, 2025-08-05). | Official value, verified via press reports |
| `twcfp-tra-tzechiang-2025-pkm` | Train — TRA Tze-Chiang (自強號) | **0.036** | As above. | Official value, verified via press reports |
| `twcfp-tra-chukuang-2025-pkm` | Train — TRA Chu-Kuang (莒光號) | **0.050** | As above. | Official value, verified via press reports |

Notes:
* The Taipei Metro value is applied to other Taiwanese metro and light-rail systems (Kaohsiung, Taoyuan, Taichung, New Taipei) as a **proxy**; those systems have different load factors.
* The TRA certificate itself was not retrieved. Values are graded `official_reported` because two independent outlets report identical figures for the MOENV-approved label.

### 4.2 UK DESNZ 2025 conversion factors

Source: UK Department for Energy Security and Net Zero, [*Greenhouse gas reporting: conversion factors 2025*](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025), published 2025-06-10. Values were read from the official **flat file** (`ghg-conversion-factors-2025-flat-format.xlsx`), "kg CO2e" total rows. The row ID of each value is recorded below.

| Factor ID | Mode / variant | Value | Unit | DESNZ row ID | Boundary |
|---|---|---|---|---|---|
| `desnz25-car-average-unknown-vkm` | Car — average, unknown fuel *(default)* | 0.16725 | kg/vehicle-km | 25_301_3074_4_1 | direct |
| `desnz25-car-average-petrol-vkm` | Car — average petrol | 0.16272 | kg/vehicle-km | 25_301_3070_4_1 | direct |
| `desnz25-car-average-bev-vkm` | Car — average battery-electric | 0.04047 | kg/vehicle-km | 25_301_3076_4_1 | incl. electricity (UK grid) |
| `desnz25-motorbike-average-vkm` | Motorcycle — average | 0.11367 | kg/vehicle-km | 25_302_3080_4_1 | direct |
| `desnz25-taxi-regular-pkm` | Taxi — regular | 0.14861 | kg/passenger-km | 25_313_3141_11_1 | direct |
| `desnz25-bus-average-local-pkm` | Bus — average local *(default)* | 0.10385 | kg/passenger-km | 25_314_3145_11_1 | direct |
| `desnz25-bus-coach-pkm` | Bus — coach | 0.02776 | kg/passenger-km | 25_314_3146_11_1 | direct |
| `desnz25-rail-national-pkm` | Train — UK national rail | 0.03546 | kg/passenger-km | 25_315_3147_11_1 | incl. electricity |
| `desnz25-rail-underground-pkm` | Metro — London Underground | 0.0278 | kg/passenger-km | 25_315_3150_11_1 | incl. electricity |
| `desnz25-rail-lightrail-pkm` | Metro — light rail and tram | 0.0286 | kg/passenger-km | 25_315_3149_11_1 | incl. electricity |
| `desnz25-rail-national-as-hsr-pkm` | HSR — national-rail proxy | 0.03546 | kg/passenger-km | 25_315_3147_11_1 | incl. electricity |

Notes on applicability to Taiwan:
* **Motorcycles:** Taiwan's fleet is dominated by ≤ 125 cc scooters, which typically emit less per km than the UK average motorbike. Treat the factor as an upper-range proxy.
* **Battery-electric cars:** Taiwan's grid is more carbon-intensive than the UK's, so the DESNZ BEV value likely **understates** a Taiwanese BEV's footprint.
* **Buses:** emissions per passenger depend strongly on occupancy, and Taiwanese urban routes may be fuller than the UK average.
* **HSR in the DESNZ set:** DESNZ publishes no domestic HSR factor. The "International rail" (Eurostar) factor was deliberately not used because it reflects the French grid.
* Well-to-tank (WTT) factors exist in DESNZ but are **not** added in this release, to keep one consistent operational boundary.

### 4.3 Conventions

| Factor ID | Mode | Value | Basis |
|---|---|---|---|
| `conv-walking-0` | Walking | 0 | Zero direct operational emissions (convention) |
| `conv-cycling-0` | Cycling (non-electric) | 0 | Zero direct operational emissions (convention) |

## 5. Values investigated but **not** used

These Taiwan-specific figures appear in secondary compilations. The official database ([產品碳足跡資訊網, cfp-calculate.tw](https://cfp-calculate.tw)) could not be reached from the development environment (DNS failure). The MOENV open-data mirror ([CFP_P_02](https://data.moenv.gov.tw/dataset/detail/CFP_P_02)) showed no transport entries without an API key. These values are listed in the app for transparency and are **excluded from all calculations**:

| Mode | Claimed value (kg CO₂e/pkm) | Claimed source | Reason not used |
|---|---|---|---|
| Car | 0.115 | MOENV carbon-footprint database, 2014 (via infinityesg.com compilation) | Entry, declared unit and boundary not verifiable |
| Motorcycle | 0.0951 | MOENV database, 2014 (via compilation) | Not verified |
| Bus (公車 甲類) | 0.0767 | MOENV database, 2017 (via compilation) | Not verified |
| Fuel car | 0.104 | Taipei City press release, 2025-10-17 (comparison figure) | No source or methodology given |

**Recommended next step for the course team:** look up these entries directly in the MOENV carbon-footprint database (or request an API key for `data.moenv.gov.tw`). If confirmed, add them as new factor IDs in `factors.ts`, bump the set version, and regenerate the seed with `npm run gen:factor-seed`.

## 6. Reporting periods and comparisons

Implemented in [`core/time.ts`](../supabase/functions/_shared/core/time.ts) and [`core/analytics.ts`](../supabase/functions/_shared/core/analytics.ts):

* Trips belong to the **local** calendar day/week/month/year in which they **started**, in the user's IANA time zone (default `Asia/Taipei`). Daylight-saving transitions are handled.
* Weeks are ISO weeks (Monday 00:00 to next Monday). Periods are half-open intervals `[start, end)`.
* **Comparisons never set an incomplete period against a complete one.** While the current period is in progress, both sides are truncated to the same elapsed local time, e.g. 1–10 October to 12:00 vs. 1–10 September to 12:00. If the previous month is shorter, its comparison window ends at its last day.
* Percentage change is `(current − previous) ÷ previous × 100`. It is **not defined** when the previous period has no calculated trips; the app then says "no baseline" instead of showing a number.
* Changes below 0.05 kg are reported as "about the same".
* The "recent daily average" on Home averages complete local days in the previous 14 days, counting only days on or after the user's first recorded trip.
* **Correlation, not causation.** Insights describe co-occurring changes ("emissions were lower while MRT trips increased"), never causal claims. The app never attributes reductions to itself.
* **Coverage.** Every report shows days with trips, trips without factors, trips needing review, mixed boundaries, and changes in the share of automatic vs. manual recording.

## 7. Scenario simulations

[`core/scenario.ts`](../supabase/functions/_shared/core/scenario.ts) estimates replacing a share of recorded trips (filtered by mode, place label and maximum distance) with another mode:

* The baseline is the user's recorded trips in the last N days, **recalculated with the current methodology** so both sides use identical factors.
* The alternative route distance is `recorded distance × multiplier` (default 1.0), or real route options when a routing provider is configured.
* Monthly projection = `Δ × 30 ÷ baseline-window days`, assuming the same trip frequency.
* All outputs are labelled **SIMULATED** and never modify recorded trips. They do not account for travel time, cost, safety or accessibility unless the user's stated constraints are applied by the assistant.

## 8. Automatic mode classification

GPS speed alone cannot reliably distinguish car, taxi, scooter, bus, MRT or train ([`core/classification.ts`](../supabase/functions/_shared/core/classification.ts)):

* Walking (85th-percentile speed < 7.5 km/h, max < 14 km/h) can be auto-confirmed at confidence ≥ 0.85.
* Cycling-range speeds are confirmed only when the OS activity signal agrees. That signal is not yet connected; see STATUS.md.
* Sustained speeds ≥ 160 km/h suggest HSR, but the trip still requires review.
* All other motorised trips get confidence ≤ 0.4 and are marked **needs review**. Following a rail line is never treated as evidence for MRT or train.

## 9. Limitations

1. Totals reflect **recorded** trips only. Missing trips are never imputed.
2. Road factors are UK proxies. Bus, taxi and car values are fleet averages, not the user's actual vehicle.
3. The Taiwan-first set mixes accounting boundaries (see §2).
4. GPS-derived distances can be wrong underground, in tunnels or with poor signal. Users can edit distances.
5. Estimates support personal awareness. They are **not** certified carbon accounting, a GHG Protocol corporate inventory or a compliance report.
6. Electricity-based factors reflect the grid and year of their source and are not adjusted to Taiwan's grid.

## 10. Updating factors (governance)

1. Never change an existing factor's value. Add a new factor ID with the new value and source.
2. Bump the factor-set `version` in `core/factors.ts`.
3. Run `npm run gen:factor-seed` and apply the new migration.
4. Update §4 of this document and the pinned-value test in `__tests__/core/factors.test.ts`.
5. Users see that their existing trips were calculated with the older version and can recalculate.
