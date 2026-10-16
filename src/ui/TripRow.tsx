import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { formatKg, formatKm } from '@core/calc.ts';
import { MODE_INFO } from '@core/modes.ts';
import type { StoredTrip } from '@/db/repository';
import { ModeIcon, Row, T, ValueBadge } from './components';
import { spacing, usePalette } from './theme';

export function timeLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
}

export function TripRow({ trip, timeZone, showSync }: { trip: StoredTrip; timeZone: string; showSync?: boolean }) {
  const router = useRouter();
  const c = usePalette();
  const minutes = Math.round((Date.parse(trip.endedAt) - Date.parse(trip.startedAt)) / 60000);
  const place = [trip.origin?.label, trip.destination?.label].filter(Boolean).join(' → ');
  const kg = trip.calcStatus === 'calculated' ? formatKg(trip.emissionsKg) : 'No factor';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${MODE_INFO[trip.mode].label} at ${timeLabel(trip.startedAt, timeZone)}, ${formatKm(trip.distanceKm)}, ${kg}${trip.confirmationStatus === 'needs_review' ? ', needs review' : ''}`}
      onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderColor: c.border, minHeight: 56 })}
    >
      <Row>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <ModeIcon mode={trip.mode} size={18} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>{MODE_INFO[trip.mode].label}</T>
            <T variant="body" style={{ fontWeight: '600' }}>{kg}</T>
          </Row>
          <T variant="small" muted numberOfLines={1}>
            {`${timeLabel(trip.startedAt, timeZone)} · ${minutes} min · ${formatKm(trip.distanceKm)}${place ? ` · ${place}` : ''}`}
          </T>
          <Row style={{ flexWrap: 'wrap', gap: 4 }}>
            {trip.confirmationStatus === 'needs_review' ? <ValueBadge kind="review" /> : null}
            {trip.detectionSource === 'auto' && trip.confirmationStatus !== 'needs_review' ? <T variant="small" muted>Auto-detected</T> : null}
            {showSync && trip.syncStatus === 'pending' ? <ValueBadge kind="pending" /> : null}
          </Row>
        </View>
      </Row>
    </Pressable>
  );
}
