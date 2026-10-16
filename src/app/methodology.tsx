import { useState } from 'react';
import { Linking, View } from 'react-native';
import { CALC_ENGINE_VERSION } from '@core/calc.ts';
import { BOUNDARY_LABELS, FACTOR_SETS, getFactorSetOrDefault, UNVERIFIED_CANDIDATES } from '@core/factors.ts';
import { MODE_INFO } from '@core/modes.ts';
import { TRANSPORT_MODES, type EmissionFactor, type FactorQuality } from '@core/types.ts';
import { useApp } from '@/state/AppProvider';
import { Banner, Button, Card, Chip, Divider, Row, Screen, T, ValueBadge } from '@/ui/components';
import { confirmAction } from '@/ui/dialogs';
import { usePalette } from '@/ui/theme';

const QUALITY_LABEL: Record<FactorQuality, string> = {
  official_primary: 'Official value, read from the publisher\'s own page or dataset',
  official_reported: 'Official approved value, verified through consistent press reports (certificate not retrieved)',
  official_proxy_other_region: 'Official value from another country, used as a proxy',
  convention: 'Accounting convention (zero direct emissions)',
};

function FactorCard({ f }: { f: EmissionFactor }) {
  const c = usePalette();
  return (
    <View style={{ gap: 4, paddingVertical: 8 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <T variant="body" style={{ fontWeight: '700', flex: 1 }}>{f.variantLabel}</T>
        <T variant="body" style={{ fontWeight: '700' }} selectable>{`${f.value} ${f.unit === 'kgCO2e/pkm' ? 'kg/pkm' : 'kg/vkm'}`}</T>
      </Row>
      <T variant="small">{f.unit === 'kgCO2e/pkm' ? 'Per passenger-km (your share already allocated).' : 'Per vehicle-km — divided by the number of occupants.'}</T>
      <T variant="small">Boundary: {BOUNDARY_LABELS[f.boundary]} · Region: {f.region}</T>
      <T variant="small" style={{ color: f.isRegionalProxy ? c.info : c.textMuted }}>Quality: {QUALITY_LABEL[f.quality]}</T>
      <T variant="small" muted selectable>
        {f.sourceOrg}. {f.sourceTitle}.{f.sourceReference ? ` ${f.sourceReference}.` : ''}{f.effectiveFrom ? ` Effective from ${f.effectiveFrom}${f.effectiveTo ? ` to ${f.effectiveTo}` : ''}.` : ''} Dataset: {f.datasetVersion}. Factor ID: {f.id}.
      </T>
      <T variant="small" muted>{f.methodologyNotes}</T>
      <Button title="Open source" variant="ghost" icon="open-outline" onPress={() => Linking.openURL(f.sourceUrl)} />
    </View>
  );
}

export default function MethodologyScreen() {
  const { prefs, trips, recalculateAll } = useApp();
  const active = getFactorSetOrDefault(prefs.factorSetId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const staleCount = trips.filter((t) => t.factorSetId !== active.id || t.factorSetVersion !== active.version || t.calcEngineVersion !== CALC_ENGINE_VERSION).length;

  async function switchTo(id: string) {
    const target = getFactorSetOrDefault(id);
    const ok = await confirmAction({
      title: `Use "${target.shortName}"?`,
      message: `New trips will use this methodology. Recalculating also updates all ${trips.length} existing trip(s) so that reports compare like with like. Each trip keeps a record of which factor and version was used.`,
      confirmLabel: 'Switch & recalculate',
    });
    if (ok) await doRecalc(id);
  }

  async function doRecalc(id: string) {
    setBusy(true);
    try {
      const n = await recalculateAll(id);
      setMessage(`Recalculated ${n} trip(s) with ${getFactorSetOrDefault(id).shortName} v${getFactorSetOrDefault(id).version}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <T variant="title">How EcoMove estimates emissions</T>
        <T variant="small" selectable>emissions (kg CO₂e) = distance (km) × factor (kg CO₂e per passenger-km)</T>
        <T variant="small" selectable>For cars and motorcycles: distance × factor (kg CO₂e per vehicle-km) ÷ people in the vehicle</T>
        <T variant="small">
          Calculations are done by a deterministic, unit-tested engine ({CALC_ENGINE_VERSION}). The AI assistant never calculates emissions itself — it calls this engine and explains the results. Each trip stores the factor ID, value, unit, accounting boundary and methodology version used, so past reports stay reproducible.
        </T>
        <T variant="small">Values are kept at full precision and rounded only for display. Invalid distances are rejected; modes without a verified factor are reported as "unavailable" rather than guessed.</T>
      </Card>

      <Card tone={active.mixedBoundaries ? 'warning' : 'primary'}>
        <T variant="label">ACTIVE METHODOLOGY</T>
        <T variant="title">{active.name}</T>
        <T variant="small" muted>Version {active.version}</T>
        <T variant="small">{active.description}</T>
        {active.caveats.map((cv) => (
          <T key={cv} variant="small">• {cv}</T>
        ))}
      </Card>

      {staleCount && !busy ? (
        <Banner
          tone="info"
          icon="refresh"
          title={`${staleCount} trip(s) were calculated with another methodology version`}
          body="They keep their original results until you recalculate."
          action={<Button title="Recalculate all trips" variant="ghost" onPress={() => void doRecalc(active.id)} />}
        />
      ) : null}
      {message ? <Banner tone="primary" icon="checkmark-circle" title={message} /> : null}

      <Card>
        <T variant="title">Choose a methodology</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {FACTOR_SETS.map((s) => (
            <Chip key={s.id} label={s.shortName} selected={s.id === active.id} onPress={() => (s.id === active.id || busy ? undefined : void switchTo(s.id))} />
          ))}
        </Row>
        <T variant="small" muted>
          "Taiwan-first" uses official Taiwanese carbon labels where they exist but mixes accounting boundaries. "DESNZ 2025" uses one consistent UK dataset — better for like-for-like mode comparisons, less specific to Taiwan.
        </T>
      </Card>

      <Card>
        <T variant="title">Accounting boundaries</T>
        <T variant="small">• Direct operational (tailpipe): fuel burned by the vehicle. Excludes fuel production and vehicle manufacture.</T>
        <T variant="small">• Operational incl. electricity: adds power-station emissions for electric traction (rail, EVs).</T>
        <T variant="small">• Life-cycle product carbon footprint: Taiwan carbon labels (ISO 14067-style) that also include stations, materials and end-of-life. Broader, so values are higher than an operational factor for the same service would be.</T>
        <T variant="small">• Walking and cycling are recorded as zero direct emissions. That is an accounting convention, not a claim that they have no life-cycle footprint.</T>
        <T variant="small">Comparing factors with different boundaries is flagged throughout the app. In the Taiwan-first set the mismatch makes rail look slightly worse relative to road than a like-for-like comparison would, so suggestions to switch to rail are conservative.</T>
      </Card>

      <T variant="h2">Factors in use</T>
      {TRANSPORT_MODES.map((m) => {
        const fs = active.factors.filter((f) => f.mode === m);
        return (
          <Card key={m}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="title">{MODE_INFO[m].label}</T>
              {fs.some((f) => f.isRegionalProxy) ? <ValueBadge kind="proxy" /> : null}
            </Row>
            {fs.length ? (
              fs.map((f, i) => (
                <View key={f.id}>
                  {i > 0 ? <Divider /> : null}
                  <FactorCard f={f} />
                </View>
              ))
            ) : (
              <T variant="small">No verified factor — trips with this mode are saved but excluded from emission totals and marked "unavailable".</T>
            )}
          </Card>
        );
      })}

      <Card tone="info">
        <T variant="title">Values found but not used</T>
        <T variant="small">During research these Taiwan-specific figures were found only in secondary compilations. Because the official source could not be checked, they are listed for transparency and are NOT used in any calculation.</T>
        {UNVERIFIED_CANDIDATES.map((u) => (
          <T key={`${u.mode}-${u.claimedValueKgPerPkm}`} variant="small">
            • {MODE_INFO[u.mode].label}: {u.claimedValueKgPerPkm} kg/pkm — {u.claimedSource}. {u.reason}
          </T>
        ))}
      </Card>

      <Card>
        <T variant="title">Known limitations</T>
        <T variant="small">• Totals include only trips you recorded. Missed trips are not estimated.</T>
        <T variant="small">• GPS cannot reliably tell car, taxi, scooter, bus, MRT or train apart; such trips are marked "needs review" until you confirm the mode.</T>
        <T variant="small">• Detected distance follows GPS points and can differ from the real route (tunnels, underground MRT, signal loss).</T>
        <T variant="small">• Bus, taxi and car factors are fleet averages; your actual vehicle, load and driving differ.</T>
        <T variant="small">• These are personal awareness estimates, not certified carbon accounting or a compliance report.</T>
      </Card>
    </Screen>
  );
}
