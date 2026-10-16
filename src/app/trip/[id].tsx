import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, View } from 'react-native';
import { formatKg, formatKm, isCalculationStale } from '@core/calc.ts';
import { allFactors, BOUNDARY_LABELS, getFactorSetOrDefault } from '@core/factors.ts';
import { MODE_INFO } from '@core/modes.ts';
import type { TransportMode } from '@core/types.ts';
import { useApp } from '@/state/AppProvider';
import { Banner, Button, Card, Chip, EmptyState, ModeIcon, Row, Screen, T, ValueBadge, type IconName } from '@/ui/components';
import { confirmAction } from '@/ui/dialogs';
import { TripForm } from '@/ui/TripForm';

const REVIEW_MODES: TransportMode[] = ['walking', 'cycling', 'motorcycle', 'car', 'taxi', 'bus', 'metro', 'train', 'hsr', 'other_public'];

export default function TripDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { trips, prefs, editTrip, confirmTrip, dismissTrip, deleteTrip, cloudActive } = useApp();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trip = trips.find((t) => t.id === id);

  if (!trip) {
    return (
      <Screen>
        <EmptyState icon="trash" title="Trip not found" body="It may have been deleted." action={<Button title="Back to trips" onPress={() => router.replace('/trips')} />} />
      </Screen>
    );
  }

  const tz = prefs.timeZone;
  const set = getFactorSetOrDefault(prefs.factorSetId);
  const factor = trip.factorId ? allFactors().find((f) => f.id === trip.factorId) : undefined;
  const stale = isCalculationStale(trip, set);
  const minutes = Math.round((Date.parse(trip.endedAt) - Date.parse(trip.startedAt)) / 60000);
  const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  if (editing) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen>
          <TripForm
            initial={{
              origin: trip.origin?.label ?? '',
              destination: trip.destination?.label ?? '',
              distanceKm: String(Number(trip.distanceKm.toFixed(2))),
              mode: trip.mode,
              variant: trip.variant,
              occupancy: trip.occupancy ?? 1,
              start: new Date(trip.startedAt),
              durationMin: String(minutes),
              notes: trip.notes ?? '',
            }}
            prefs={prefs}
            submitLabel="Save changes"
            onSubmit={async (input) => {
              await editTrip(trip.id, {
                startedAt: input.startedAt,
                endedAt: input.endedAt,
                distanceKm: input.distanceKm,
                mode: input.mode,
                variant: input.variant,
                occupancy: input.occupancy,
                origin: input.origin?.label !== (trip.origin?.label ?? undefined) ? (input.origin ? { ...trip.origin, label: input.origin.label } : null) : trip.origin,
                destination: input.destination?.label !== (trip.destination?.label ?? undefined) ? (input.destination ? { ...trip.destination, label: input.destination.label } : null) : trip.destination,
                notes: input.notes,
              });
              setEditing(false);
            }}
          />
          <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} />
        </Screen>
      </KeyboardAvoidingView>
    );
  }

  return (
    <Screen>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row>
            <ModeIcon mode={trip.mode} size={24} />
            <T variant="title">{MODE_INFO[trip.mode].label}</T>
          </Row>
          <ValueBadge kind={trip.confirmationStatus === 'needs_review' ? 'review' : 'recorded'} />
        </Row>
        <T variant="h1">{trip.calcStatus === 'calculated' ? `${formatKg(trip.emissionsKg)} CO₂e` : 'No emission factor'}</T>
        <T variant="small" muted>{`${fmtTime(trip.startedAt)} · ${minutes} min · ${formatKm(trip.distanceKm)}`}</T>
        {trip.origin?.label || trip.destination?.label ? <T variant="small">{[trip.origin?.label, trip.destination?.label].filter(Boolean).join(' → ')}</T> : null}
        {trip.confirmationStatus === 'dismissed' ? <T variant="small" muted>Dismissed — excluded from all totals.</T> : null}
      </Card>

      {error ? <Banner tone="danger" icon="alert-circle" title="Could not update" body={error} /> : null}

      {trip.confirmationStatus === 'needs_review' ? (
        <Card tone="warning">
          <T variant="title">Which mode was this?</T>
          <T variant="small">
            Detected automatically. Suggested: {MODE_INFO[trip.proposedMode ?? trip.mode].label}
            {trip.classificationConfidence != null ? ` (confidence ${Math.round(trip.classificationConfidence * 100)}%)` : ''}. Speed alone cannot reliably separate cars, scooters, buses and trains.
          </T>
          <Row style={{ flexWrap: 'wrap' }}>
            {REVIEW_MODES.map((m) => (
              <Chip
                key={m}
                label={MODE_INFO[m].label}
                icon={MODE_INFO[m].icon as IconName}
                selected={m === trip.mode}
                onPress={() => act(() => (m === trip.mode ? confirmTrip(trip.id) : editTrip(trip.id, { mode: m })))}
              />
            ))}
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title={`Confirm ${MODE_INFO[trip.mode].label}`} icon="checkmark" onPress={() => act(() => confirmTrip(trip.id))} />
            <Button title="Not a real trip" variant="secondary" icon="close" onPress={() => act(() => dismissTrip(trip.id))} />
          </Row>
        </Card>
      ) : null}

      <Card>
        <T variant="title">How this was calculated</T>
        {trip.calcStatus === 'calculated' && trip.factorValue != null ? (
          <>
            <T variant="body" selectable>
              {trip.factorUnit === 'kgCO2e/vkm'
                ? `${trip.distanceKm.toFixed(2)} km × ${trip.factorValue} kg CO₂e per vehicle-km ÷ ${trip.occupancyApplied ?? 1} occupant(s) = ${trip.emissionsKg!.toFixed(4)} kg CO₂e`
                : `${trip.distanceKm.toFixed(2)} km × ${trip.factorValue} kg CO₂e per passenger-km = ${trip.emissionsKg!.toFixed(4)} kg CO₂e`}
            </T>
            <T variant="small">Factor: {factor?.variantLabel ?? trip.factorId}</T>
            {trip.boundary ? <T variant="small">Accounting boundary: {BOUNDARY_LABELS[trip.boundary]}</T> : null}
            {factor ? <T variant="small">Source: {factor.sourceOrg}{factor.sourceReference ? ` (${factor.sourceReference})` : ''}</T> : null}
            {factor?.isRegionalProxy || (factor && factor.region !== 'TW' && factor.region !== 'TW-TPE' && factor.region !== 'ANY') ? <ValueBadge kind="proxy" /> : null}
            {factor ? <Button title="Open source document" variant="ghost" icon="open-outline" onPress={() => Linking.openURL(factor.sourceUrl)} /> : null}
          </>
        ) : (
          <T variant="small">
            No emission factor is available for "{MODE_INFO[trip.mode].label}" in the selected methodology, so this trip is excluded from emission totals (its distance still counts). Choose a more specific mode to include it.
          </T>
        )}
        <T variant="small" muted>
          Methodology {trip.factorSetId} v{trip.factorSetVersion} · engine {trip.calcEngineVersion} · calculated {fmtTime(trip.calculatedAt)}
        </T>
        {stale ? (
          <Banner
            tone="info"
            icon="refresh"
            title="Calculated with a different methodology version"
            body={`Your current methodology is "${set.shortName}" v${set.version}. Historical results are kept as recorded until you recalculate.`}
            action={<Button title="Recalculate this trip" variant="ghost" onPress={() => act(() => editTrip(trip.id, {}))} />}
          />
        ) : null}
      </Card>

      <Card>
        <T variant="title">Record</T>
        <T variant="small">Detected: {trip.detectionSource === 'auto' ? 'automatically' : 'entered manually'}</T>
        <T variant="small">Status: {trip.confirmationStatus.replace('_', ' ')}</T>
        {trip.detectionSource === 'auto' && trip.proposedMode && trip.proposedMode !== trip.mode ? <T variant="small">Originally proposed: {MODE_INFO[trip.proposedMode].label}</T> : null}
        {trip.origin?.lat != null ? <T variant="small">Start/end coordinates are stored on this device{cloudActive ? ' and in your account' : ''} (rounded to about 110 m unless you enabled precise endpoints in Privacy). They are never sent to the AI assistant.</T> : null}
        {cloudActive ? <T variant="small">Sync: {trip.syncStatus === 'pending' ? 'waiting to upload' : 'saved to your account'}</T> : null}
        {trip.notes ? <T variant="small">Notes: {trip.notes}</T> : null}
      </Card>

      <View style={{ gap: 8 }}>
        <Button title="Edit trip" icon="create" variant="secondary" onPress={() => setEditing(true)} />
        {trip.confirmationStatus === 'dismissed' ? (
          <Button title="Restore trip" icon="arrow-undo" variant="secondary" onPress={() => act(() => confirmTrip(trip.id))} />
        ) : trip.detectionSource === 'auto' && trip.confirmationStatus !== 'needs_review' ? (
          <Button title="Mark as not a real trip" icon="close-circle" variant="secondary" onPress={() => act(() => dismissTrip(trip.id))} />
        ) : null}
        <Button
          title="Delete trip"
          icon="trash"
          variant="danger"
          onPress={async () => {
            const ok = await confirmAction({
              title: 'Delete this trip?',
              message: `It will be removed permanently from this ${Platform.OS === 'web' ? 'browser' : 'device'}` + (cloudActive ? ' and your account.' : '.'),
              confirmLabel: 'Delete',
              destructive: true,
            });
            if (ok) act(async () => { await deleteTrip(trip.id); if (router.canGoBack()) router.back(); else router.replace('/trips'); });
          }}
        />
      </View>
    </Screen>
  );
}
