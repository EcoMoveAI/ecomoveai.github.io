import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatKg } from '@core/calc.ts';
import { localDateKey } from '@core/time.ts';
import { useApp } from '@/state/AppProvider';
import { trackingSupported } from '@/tracking/tracker';
import { Button, Chip, CONTENT_MAX_WIDTH, EmptyState, Row, T } from '@/ui/components';
import { TripRow } from '@/ui/TripRow';
import { spacing, usePalette } from '@/ui/theme';

type Filter = 'all' | 'review' | 'auto' | 'manual' | 'dismissed' | 'unsynced';
const FILTERS: Filter[] = ['all', 'review', 'auto', 'manual', 'dismissed', 'unsynced'];

export default function TripsScreen() {
  const router = useRouter();
  const c = usePalette();
  // The filter lives in the URL so links such as /trips?filter=review (from Home) select it.
  const params = useLocalSearchParams<{ filter?: string }>();
  const { trips, prefs, cloudActive, sync, syncNow } = useApp();
  const filter: Filter = FILTERS.includes(params.filter as Filter) ? (params.filter as Filter) : 'all';
  const setFilter = (f: Filter) => router.setParams({ filter: f });

  const filtered = useMemo(
    () =>
      trips.filter((t) => {
        switch (filter) {
          case 'review': return t.confirmationStatus === 'needs_review';
          case 'auto': return t.detectionSource === 'auto' && t.confirmationStatus !== 'dismissed';
          case 'manual': return t.detectionSource === 'manual';
          case 'dismissed': return t.confirmationStatus === 'dismissed';
          case 'unsynced': return t.syncStatus === 'pending';
          default: return t.confirmationStatus !== 'dismissed';
        }
      }),
    [trips, filter],
  );

  const sections = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const t of filtered) {
      const k = localDateKey(t.startedAt, prefs.timeZone);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()].map(([date, data]) => ({
      date,
      total: data.reduce((a, t) => a + (t.calcStatus === 'calculated' && t.confirmationStatus !== 'dismissed' ? t.emissionsKg ?? 0 : 0), 0),
      data,
    }));
  }, [filtered, prefs.timeZone]);

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'review', label: `Needs review (${trips.filter((t) => t.confirmationStatus === 'needs_review').length})` },
    { key: 'auto', label: 'Auto' },
    { key: 'manual', label: 'Manual' },
    { key: 'dismissed', label: 'Dismissed' },
    ...(cloudActive ? [{ key: 'unsynced' as Filter, label: `Not synced (${sync.pending})` }] : []),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={[]}>
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: spacing.lg, gap: 2, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
            <Row style={{ flexWrap: 'wrap' }}>
              {filters.map((f) => (
                <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </Row>
            <Row>
              <Button title="Add trip" icon="add" onPress={() => router.push('/trip/new')} style={{ flex: 1 }} />
              {cloudActive ? <Button title={sync.syncing ? 'Syncing…' : 'Sync'} icon="sync" variant="secondary" loading={sync.syncing} onPress={syncNow} /> : null}
            </Row>
            {cloudActive && sync.lastError ? <T variant="small" style={{ color: c.warning }}>Last sync failed; changes are kept on this {Platform.OS === 'web' ? 'browser' : 'device'} and will be retried. ({sync.lastError})</T> : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
            <T variant="label">{new Date(`${section.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</T>
            <T variant="small" muted>{formatKg(section.total)}</T>
          </Row>
        )}
        renderItem={({ item }) => <TripRow trip={item} timeZone={prefs.timeZone} showSync={cloudActive} />}
        ListEmptyComponent={
          <EmptyState
            icon="map"
            title={filter === 'all' ? 'No trips recorded yet' : 'No trips match this filter'}
            body={filter === 'all' ? (trackingSupported ? 'Add your first trip manually, or turn on trip detection from the Home screen.' : 'Add your first trip with "Add trip".') : 'Try another filter.'}
          />
        }
      />
    </SafeAreaView>
  );
}
