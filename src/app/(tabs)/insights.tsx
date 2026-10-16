import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { comparePeriods, periodLabel, seriesForPeriod } from '@core/analytics.ts';
import { formatKg, formatKm } from '@core/calc.ts';
import { generateInsights } from '@core/insights.ts';
import { MODE_INFO } from '@core/modes.ts';
import { periodRange, shiftPeriod } from '@core/time.ts';
import type { PeriodKind } from '@core/types.ts';
import { useApp } from '@/state/AppProvider';
import { useNow } from '@/state/useNow';
import { BarChart, ModeBreakdown } from '@/ui/charts';
import { Button, Card, EmptyState, Row, Screen, Segmented, StatTile, T, ValueBadge } from '@/ui/components';
import { MIN_TOUCH, usePalette } from '@/ui/theme';

export default function InsightsScreen() {
  const router = useRouter();
  const c = usePalette();
  const { trips, prefs } = useApp();
  const now = useNow();
  const tz = prefs.timeZone;
  const [kind, setKind] = useState<PeriodKind>('month');
  const [offset, setOffset] = useState(0);

  const range = useMemo(() => shiftPeriod(periodRange(kind, now, tz), offset), [kind, now, tz, offset]);
  const cmp = useMemo(() => comparePeriods(trips, range, now), [trips, range, now]);
  const series = useMemo(() => seriesForPeriod(trips, range), [trips, range]);
  const insights = useMemo(() => generateInsights(trips, range, now), [trips, range, now]);
  const s = cmp.current;
  const inProgress = cmp.windows.basis === 'elapsed';

  const changeText = (() => {
    switch (cmp.direction) {
      case 'no_data': return 'No trips in either period.';
      case 'no_baseline': return `No calculated trips in ${cmp.windows.previous.key} to compare with.`;
      case 'no_change': return `About the same as ${cmp.windows.previous.key}.`;
      default: {
        const sign = cmp.absoluteChangeKg > 0 ? '+' : '−';
        return `${sign}${formatKg(Math.abs(cmp.absoluteChangeKg))} (${sign}${Math.abs(cmp.percentChange ?? 0).toFixed(0)}%) vs. ${cmp.windows.previous.key}`;
      }
    }
  })();

  return (
    <Screen>
      <Segmented
        value={kind}
        onChange={(k) => { setKind(k); setOffset(0); }}
        options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous period" onPress={() => setOffset(offset - 1)} style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={c.primary} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <T variant="title">{periodLabel(range)}</T>
          {inProgress ? <T variant="small" muted>In progress</T> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Next period" accessibilityState={{ disabled: offset >= 0 }} disabled={offset >= 0} onPress={() => setOffset(offset + 1)} style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center', alignItems: 'flex-end', opacity: offset >= 0 ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={24} color={c.primary} />
        </Pressable>
      </Row>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="label">{inProgress ? `${kind.toUpperCase()} TO DATE` : `TOTAL ${kind.toUpperCase()}`}</T>
          <ValueBadge kind="recorded" />
        </Row>
        <T variant="h1">{formatKg(s.emissionsKg)} CO₂e</T>
        <T variant="small" style={{ fontWeight: '600' }}>{changeText}</T>
        {inProgress ? <T variant="small" muted>Compared over the same elapsed period ({cmp.windows.description}), not against the complete previous {kind}.</T> : null}
      </Card>

      <Row>
        <StatTile label="Distance" value={formatKm(s.distanceKm)} />
        <StatTile label="Trips" value={String(s.tripCount)} />
        <StatTile label="Days with trips" value={`${s.coverage.daysWithTrips}/${s.coverage.daysInWindow}`} />
      </Row>

      {s.tripCount === 0 && cmp.previous.tripCount === 0 ? (
        <EmptyState icon="stats-chart" title="Nothing recorded for this period" body="Reports are built only from trips you have saved. Nothing is estimated for missing days." />
      ) : (
        <>
          {kind !== 'day' ? (
            <Card>
              <T variant="title">{kind === 'year' ? 'Monthly emissions' : 'Daily emissions'}</T>
              <BarChart data={series.map((p) => ({ key: p.key, label: p.label, value: p.emissionsKg }))} />
            </Card>
          ) : null}

          <Card>
            <T variant="title">By transport mode</T>
            <ModeBreakdown byMode={s.byMode} totalKg={s.emissionsKg} />
          </Card>

          {cmp.direction === 'increase' || cmp.direction === 'decrease' ? (
            <Card>
              <T variant="title">What changed vs. {cmp.windows.previous.key}</T>
              {cmp.modeDeltas.filter((m) => Math.abs(m.deltaKg) >= 0.01 || m.deltaTrips !== 0).map((m) => (
                <Row key={m.mode} style={{ justifyContent: 'space-between' }}>
                  <T variant="small" style={{ flex: 1 }}>{MODE_INFO[m.mode].label}</T>
                  <T variant="small">{`${m.deltaTrips > 0 ? '+' : ''}${m.deltaTrips} trips · ${m.deltaKm > 0 ? '+' : ''}${m.deltaKm.toFixed(1)} km · ${m.deltaKg > 0 ? '+' : '−'}${formatKg(Math.abs(m.deltaKg))}`}</T>
                </Row>
              ))}
              <T variant="small" muted>These are differences in your recorded trips. They show what changed together, not what caused the change.</T>
            </Card>
          ) : null}

          <T variant="title">Insights</T>
          {insights.map((i) => (
            <Card key={i.id} tone={i.tone === 'attention' ? 'warning' : i.tone === 'positive' ? 'primary' : 'default'}>
              <T variant="body" style={{ fontWeight: '700' }}>{i.title}</T>
              <T variant="small">{i.body}</T>
            </Card>
          ))}

          {cmp.dataQualityNotes.length ? (
            <Card tone="info">
              <T variant="label">DATA COVERAGE & LIMITATIONS</T>
              {cmp.dataQualityNotes.map((n) => (
                <T key={n} variant="small">• {n}</T>
              ))}
              <T variant="small">• Trips you did not record are not included; totals reflect recorded travel only.</T>
            </Card>
          ) : null}
        </>
      )}

      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="Goals" icon="flag" variant="secondary" onPress={() => router.push('/goals')} />
        <Button title="What-if scenarios" icon="git-compare" variant="secondary" onPress={() => router.push('/scenario')} />
        <Button title="Methodology" icon="book" variant="ghost" onPress={() => router.push('/methodology')} />
      </Row>
    </Screen>
  );
}
