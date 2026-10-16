/**
 * Deterministic what-if simulator and mode comparison (screen 16). Works offline; results are labelled
 * SIMULATED / ESTIMATE and never change recorded trips. The AI assistant calls the same functions.
 */
import { useState } from 'react';
import { formatKg } from '@core/calc.ts';
import { getFactorSetOrDefault } from '@core/factors.ts';
import { MODE_INFO } from '@core/modes.ts';
import { compareModesForDistance, simulateModeShift, validateScenario, type ModeShiftScenarioInput } from '@core/scenario.ts';
import type { TransportMode } from '@core/types.ts';
import { useApp } from '@/state/AppProvider';
import { useNow } from '@/state/useNow';
import { Banner, Card, Chip, Field, Row, Screen, Segmented, T, ValueBadge, type IconName } from '@/ui/components';

const FROM: TransportMode[] = ['car', 'taxi', 'motorcycle', 'bus'];
const TO: TransportMode[] = ['metro', 'bus', 'train', 'cycling', 'walking', 'motorcycle', 'car'];
const COMPARE: TransportMode[] = ['walking', 'cycling', 'metro', 'train', 'hsr', 'bus', 'motorcycle', 'car', 'taxi'];

export default function ScenarioScreen() {
  const { trips, prefs } = useApp();
  const now = useNow();
  const set = getFactorSetOrDefault(prefs.factorSetId);
  const [tab, setTab] = useState<'shift' | 'compare'>('shift');
  const [from, setFrom] = useState<TransportMode[]>(['taxi']);
  const [to, setTo] = useState<TransportMode>('metro');
  const [share, setShare] = useState(1);
  const [days, setDays] = useState<30 | 60 | 90>(30);
  const [place, setPlace] = useState('');
  const [maxKm, setMaxKm] = useState('');
  const [mult, setMult] = useState('1.0');
  const [distance, setDistance] = useState('8');

  const input: ModeShiftScenarioInput = {
    fromModes: from,
    toMode: to,
    shareReplaced: share,
    baselineWindow: { start: new Date(now.getTime() - days * 86400000).toISOString(), end: now.toISOString() },
    placeFilter: place.trim() || null,
    maxTripKm: maxKm.trim() ? Number(maxKm) : null,
    distanceMultiplier: Number(mult) || 1,
  };
  const errors = validateScenario(input);
  const result = errors.length ? null : simulateModeShift(trips, input, set, prefs);
  const dist = Number(distance);
  const comparison = Number.isFinite(dist) && dist > 0 && dist <= 1500 ? compareModesForDistance(dist, COMPARE, set, prefs) : null;

  return (
    <Screen>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'shift', label: 'Switch modes' }, { value: 'compare', label: 'Compare modes' }]} />
      {tab === 'shift' ? (
        <>
          <Card>
            <T variant="label">REPLACE MY RECORDED TRIPS BY</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {FROM.map((m) => (
                <Chip key={m} label={MODE_INFO[m].label} icon={MODE_INFO[m].icon as IconName} selected={from.includes(m)} onPress={() => setFrom(from.includes(m) ? from.filter((x) => x !== m) : [...from, m])} />
              ))}
            </Row>
            <T variant="label">WITH</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {TO.map((m) => (
                <Chip key={m} label={MODE_INFO[m].label} icon={MODE_INFO[m].icon as IconName} selected={to === m} onPress={() => setTo(m)} />
              ))}
            </Row>
            <T variant="label">SHARE OF THOSE TRIPS THAT SWITCH</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {[0.25, 0.5, 0.75, 1].map((s) => (
                <Chip key={s} label={`${s * 100}%`} selected={share === s} onPress={() => setShare(s)} />
              ))}
            </Row>
            <T variant="label">BASELINE: MY LAST</T>
            <Segmented value={String(days) as '30' | '60' | '90'} onChange={(v) => setDays(Number(v) as 30 | 60 | 90)} options={[{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]} />
            <Field label="Only trips to/from (optional)" value={place} onChangeText={setPlace} placeholder='e.g. "campus"' maxLength={60} />
            <Field label="Only trips up to (km, optional)" value={maxKm} onChangeText={setMaxKm} keyboardType="decimal-pad" />
            <Field label="Alternative route length vs. recorded" value={mult} onChangeText={setMult} keyboardType="decimal-pad" hint="1.0 = same distance; 1.2 = 20% longer (e.g. a less direct MRT route)." />
          </Card>
          {errors.length ? <Banner tone="warning" icon="warning" title="Adjust the scenario" body={errors.join(' ')} /> : null}
          {result ? (
            <Card tone="warning">
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="label">RESULT</T>
                <ValueBadge kind="simulated" />
              </Row>
              <T variant="h2">
                {result.matchedTrips === 0 ? 'No matching trips' : `${result.deltaKg <= 0 ? '−' : '+'}${formatKg(Math.abs(result.projectedMonthlyDeltaKg))} per month`}
              </T>
              {result.matchedTrips > 0 ? (
                <>
                  <T variant="small">
                    {`Based on ${result.matchedTrips} trip(s), ${result.matchedDistanceKm.toFixed(1)} km in the last ${days} days: ${formatKg(result.baselineKg)} → ${formatKg(result.alternativeKg)} (${result.deltaKg <= 0 ? '−' : '+'}${formatKg(Math.abs(result.deltaKg))}${result.deltaPctOfMatched != null ? `, ${Math.abs(result.deltaPctOfMatched).toFixed(0)}% ${result.deltaKg <= 0 ? 'less' : 'more'} for these trips` : ''}).`}
                  </T>
                </>
              ) : null}
              <T variant="label">ASSUMPTIONS</T>
              {result.assumptions.map((a) => (
                <T key={a} variant="small">• {a}</T>
              ))}
              {result.warnings.map((w) => (
                <T key={w} variant="small" muted>• {w}</T>
              ))}
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card>
            <Field label="Trip distance (km)" value={distance} onChangeText={setDistance} keyboardType="decimal-pad" />
            <T variant="small" muted>Uses the same distance for every mode and your default occupancy (car {prefs.defaultCarOccupancy}, scooter {prefs.defaultMotorcycleOccupancy}).</T>
          </Card>
          {comparison ? (
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="title">Estimated emissions</T>
                <ValueBadge kind="estimate" />
              </Row>
              {comparison.rows.map((r) => (
                <Row key={r.mode} style={{ justifyContent: 'space-between', minHeight: 32 }}>
                  <T variant="small" style={{ flex: 1 }}>{MODE_INFO[r.mode].label}{r.variantLabel ? ` · ${r.variantLabel}` : ''}</T>
                  <T variant="small" style={{ fontWeight: '700' }}>{r.status === 'calculated' ? formatKg(r.emissionsKg) : 'n/a'}</T>
                </Row>
              ))}
              {comparison.notes.map((n) => (
                <T key={n} variant="small" muted>• {n}</T>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
