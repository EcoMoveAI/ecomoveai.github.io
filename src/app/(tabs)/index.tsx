import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { percentChange, recentDailyAverage, summarize } from '@core/analytics.ts';
import { formatKg, formatKm } from '@core/calc.ts';
import { getFactorSetOrDefault } from '@core/factors.ts';
import { generateInsights } from '@core/insights.ts';
import { periodRange } from '@core/time.ts';
import { useApp } from '@/state/AppProvider';
import { useNow } from '@/state/useNow';
import { useOnline } from '@/state/useOnline';
import { getTrackingStatus, trackingSupported } from '@/tracking/tracker';
import { ModeBreakdown } from '@/ui/charts';
import { Banner, Button, Card, EmptyState, Row, Screen, StatTile, T, ValueBadge } from '@/ui/components';
import { TripRow } from '@/ui/TripRow';
import { usePalette } from '@/ui/theme';

export default function Home() {
  const router = useRouter();
  const c = usePalette();
  const { trips, prefs, settings, cloudActive, sync } = useApp();
  const now = useNow();
  const online = useOnline();
  const tz = prefs.timeZone;
  const [trackingLabel, setTrackingLabel] = useState('Off');

  useFocusEffect(
    useCallback(() => {
      getTrackingStatus()
        .then((s) =>
          setTrackingLabel(settings.trackingEnabled && (s.backgroundActive || s.foregroundActive) ? (s.backgroundActive ? 'On · background' : 'On · while app is open') : 'Off'),
        )
        .catch(() => setTrackingLabel('Unavailable'));
    }, [settings.trackingEnabled]),
  );

  const today = useMemo(() => periodRange('day', now, tz), [now, tz]);
  const summary = useMemo(() => summarize(trips, today, tz), [trips, today, tz]);
  const avg = useMemo(() => recentDailyAverage(trips, today, 14), [trips, today]);
  const todayTrips = useMemo(
    () => trips.filter((t) => t.startedAt >= today.start && t.startedAt < today.end && t.confirmationStatus !== 'dismissed'),
    [trips, today],
  );
  const review = trips.filter((t) => t.confirmationStatus === 'needs_review').length;
  const insight = useMemo(() => {
    const week = periodRange('week', now, tz);
    return generateInsights(trips, week, now).find((i) => i.kind !== 'no_data' && i.kind !== 'data_quality') ?? null;
  }, [trips, now, tz]);
  const set = getFactorSetOrDefault(prefs.factorSetId);
  const vsAvg = avg ? percentChange(summary.emissionsKg, avg.averageKg) : null;
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });

  return (
    <Screen>
      <T variant="small" muted>{dateLabel}</T>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="label">TODAY'S MOBILITY FOOTPRINT</T>
          <ValueBadge kind="recorded" />
        </Row>
        <T variant="display" accessibilityLabel={`${formatKg(summary.emissionsKg)} carbon dioxide equivalent today`}>{formatKg(summary.emissionsKg)}</T>
        <T variant="small" muted>CO₂e from {summary.calculatedTrips} trip{summary.calculatedTrips === 1 ? '' : 's'} with an emission factor</T>
        {avg ? (
          <T variant="small">
            {vsAvg == null
              ? `Your recent daily average is ${formatKg(avg.averageKg)} (last ${avg.daysUsed} days).`
              : `${Math.abs(vsAvg).toFixed(0)}% ${vsAvg >= 0 ? 'above' : 'below'} your recent daily average of ${formatKg(avg.averageKg)} (last ${avg.daysUsed} day${avg.daysUsed === 1 ? '' : 's'}${today.end > now.toISOString() ? '; today is not over yet' : ''}).`}
          </T>
        ) : (
          <T variant="small" muted>Your recent daily average will appear once you have earlier days recorded.</T>
        )}
        {summary.unavailableTrips ? <T variant="small" style={{ color: c.warning }}>{summary.unavailableTrips} trip(s) today have no emission factor and are not included.</T> : null}
      </Card>

      <Row>
        <StatTile label="Distance" value={formatKm(summary.distanceKm)} />
        <StatTile label="Trips" value={String(summary.tripCount)} />
      </Row>

      {!online && cloudActive ? (
        <Banner
          tone="info"
          icon="cloud-offline"
          title="You're offline"
          body={`New and edited trips are saved in this browser and will sync when you're back online${sync.pending ? ` (${sync.pending} waiting)` : ''}. The AI assistant needs a connection.`}
        />
      ) : null}

      {trackingSupported ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T variant="label">TRIP DETECTION</T>
              <T variant="title">{trackingLabel}</T>
            </View>
            <Button title={trackingLabel.startsWith('On') ? 'Manage' : 'Set up'} variant="secondary" icon="navigate" onPress={() => router.push('/tracking')} />
          </Row>
        </Card>
      ) : null}

      {review > 0 ? (
        <Banner
          tone="warning"
          icon="help-circle"
          title={`${review} trip${review === 1 ? '' : 's'} need${review === 1 ? 's' : ''} your confirmation`}
          body="GPS cannot always tell car, scooter, bus or MRT apart. Confirm the mode so your footprint is accurate."
          action={<Button title="Review trips" variant="ghost" onPress={() => router.push({ pathname: '/trips', params: { filter: 'review' } })} />}
        />
      ) : null}

      <Button title="Add a trip" icon="add-circle" onPress={() => router.push('/trip/new')} />

      <Card>
        <T variant="title">Today by mode</T>
        <ModeBreakdown byMode={summary.byMode} totalKg={summary.emissionsKg} />
      </Card>

      <Card>
        <T variant="title">Today's trips</T>
        {todayTrips.length ? (
          [...todayTrips].reverse().map((t) => <TripRow key={t.id} trip={t} timeZone={tz} showSync={cloudActive} />)
        ) : (
          <EmptyState
            icon="footsteps"
            title="No trips yet today"
            body={trackingSupported ? 'Turn on trip detection or add a trip manually. Nothing is estimated for trips you have not recorded.' : 'Add a trip manually. Nothing is estimated for trips you have not recorded.'}
          />
        )}
      </Card>

      {insight ? (
        <Card tone="info">
          <T variant="label">INSIGHT FROM YOUR DATA · THIS WEEK</T>
          <T variant="body" style={{ fontWeight: '700' }}>{insight.title}</T>
          <T variant="small">{insight.body}</T>
          <Button title="Ask the AI assistant why" variant="ghost" onPress={() => router.push('/assistant')} />
        </Card>
      ) : null}

      <T variant="small" muted>
        Estimates use "{set.shortName}" (v{set.version}). {set.mixedBoundaries ? 'This set mixes accounting boundaries — see Methodology.' : ''}
        {cloudActive && sync.pending ? ` ${sync.pending} change(s) waiting to sync.` : ''}
      </T>
      <Button title="How are these numbers calculated?" variant="ghost" onPress={() => router.push('/methodology')} />
    </Screen>
  );
}
