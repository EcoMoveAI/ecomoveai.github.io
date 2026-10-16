import { useState } from 'react';
import { Platform, View } from 'react-native';
import { calculateEmissions, formatKg } from '@core/calc.ts';
import { BOUNDARY_LABELS, getFactorSetOrDefault, variantsForMode } from '@core/factors.ts';
import { MODE_INFO } from '@core/modes.ts';
import { validateTripInput, type TripInput } from '@core/trips.ts';
import { TRANSPORT_MODES, type TransportMode, type UserPreferences } from '@core/types.ts';
import { Banner, Button, Card, Chip, Field, ModePicker, Row, T, ValueBadge } from './components';
import { DateTimeField } from './DateTimeField';
import { spacing, usePalette } from './theme';

export interface TripFormValues {
  origin: string;
  destination: string;
  distanceKm: string;
  mode: TransportMode | null;
  variant: string | null;
  occupancy: number;
  start: Date;
  durationMin: string;
  notes: string;
}

// Distances are entered manually. Online route estimation (Google Maps Routes API) was removed from the
// form because it requires a billing account; the agent's get_route_options tool reports it as unavailable.
export function TripForm({
  initial,
  prefs,
  submitLabel,
  onSubmit,
}: {
  initial: TripFormValues;
  prefs: UserPreferences;
  submitLabel: string;
  onSubmit: (input: TripInput) => Promise<void>;
}) {
  const c = usePalette();
  const [v, setV] = useState<TripFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const set = getFactorSetOrDefault(prefs.factorSetId);
  const patch = (p: Partial<TripFormValues>) => setV((prev) => ({ ...prev, ...p }));

  const distance = Number(v.distanceKm.replace(',', '.'));
  const duration = Number(v.durationMin);
  const input: TripInput | null = v.mode
    ? {
        startedAt: v.start.toISOString(),
        endedAt: new Date(v.start.getTime() + (Number.isFinite(duration) ? duration : 0) * 60000).toISOString(),
        distanceKm: v.distanceKm.trim() === '' ? Number.NaN : distance,
        mode: v.mode,
        variant: v.variant,
        occupancy: v.mode && MODE_INFO[v.mode].occupancyApplies ? v.occupancy : null,
        origin: v.origin.trim() ? { label: v.origin.trim() } : null,
        destination: v.destination.trim() ? { label: v.destination.trim() } : null,
        notes: v.notes.trim() || null,
      }
    : null;
  const validation = input ? validateTripInput(input) : null;
  const preview =
    input && Number.isFinite(input.distanceKm)
      ? calculateEmissions({ distanceKm: input.distanceKm, mode: input.mode, variant: input.variant, occupancy: input.occupancy }, set)
      : null;
  const variants = v.mode ? variantsForMode(set, v.mode) : [];
  const durationError = !Number.isFinite(duration) || duration < 0 ? 'Enter minutes (0 or more).' : null;

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <T variant="title">Transport mode</T>
        <ModePicker value={v.mode} onChange={(m) => patch({ mode: m, variant: null, occupancy: m === 'car' ? prefs.defaultCarOccupancy : m === 'motorcycle' ? prefs.defaultMotorcycleOccupancy : 1 })} modes={[...TRANSPORT_MODES]} />
        {variants.length > 1 ? (
          <>
            <T variant="label">TYPE</T>
            <Row style={{ flexWrap: 'wrap' }}>
              {variants.map((f) => (
                <Chip key={f.variant} label={f.variantLabel} selected={(v.variant ?? set.defaultVariants[v.mode as TransportMode]) === f.variant} onPress={() => patch({ variant: f.variant })} />
              ))}
            </Row>
          </>
        ) : null}
        {v.mode && MODE_INFO[v.mode].occupancyApplies ? (
          <>
            <T variant="label">PEOPLE IN THE VEHICLE (INCLUDING YOU)</T>
            <Row>
              <Button title="−" variant="secondary" onPress={() => patch({ occupancy: Math.max(1, v.occupancy - 1) })} accessibilityHint="Decrease occupancy" />
              <T variant="title" accessibilityLabel={`${v.occupancy} people`}>{v.occupancy}</T>
              <Button title="+" variant="secondary" onPress={() => patch({ occupancy: Math.min(v.mode === 'motorcycle' ? 2 : 9, v.occupancy + 1) })} accessibilityHint="Increase occupancy" />
            </Row>
            <T variant="small" muted>Vehicle emissions are shared equally between occupants.</T>
          </>
        ) : null}
      </Card>

      <Card>
        <T variant="title">Route</T>
        <Field label="From (optional)" value={v.origin} onChangeText={(t) => patch({ origin: t })} placeholder="e.g. Home, Taipei Main Station" maxLength={120} />
        <Field label="To (optional)" value={v.destination} onChangeText={(t) => patch({ destination: t })} placeholder="e.g. NTU campus" maxLength={120} />
        <T variant="small" muted>Enter the distance you travelled, for example from a map app. Place names are optional and only shown in your trip list.</T>
        <Field
          label="Distance (km)"
          value={v.distanceKm}
          onChangeText={(t) => patch({ distanceKm: t })}
          keyboardType="decimal-pad"
          placeholder="e.g. 7.5"
          error={v.distanceKm && validation?.errors.find((e) => /distance/i.test(e)) ? validation.errors.find((e) => /distance/i.test(e)) : null}
        />
      </Card>

      <Card>
        <T variant="title">When</T>
        <DateTimeField value={v.start} onChange={(d) => patch({ start: d })} />
        <Field label="Duration (minutes)" value={v.durationMin} onChangeText={(t) => patch({ durationMin: t })} keyboardType="number-pad" error={durationError} />
        <T variant="small" muted>Times use this {Platform.OS === 'web' ? "device's" : "phone's"} clock; reports group trips by your time zone ({prefs.timeZone}).</T>
      </Card>

      <Field label="Notes (optional)" value={v.notes} onChangeText={(t) => patch({ notes: t })} maxLength={500} multiline />

      {preview ? (
        <Card tone="info">
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="label">EMISSIONS PREVIEW</T>
            <ValueBadge kind="estimate" />
          </Row>
          {preview.status === 'calculated' ? (
            <>
              <T variant="h2">{formatKg(preview.emissionsKg)} CO₂e</T>
              <T variant="small" selectable>{preview.formula}</T>
              <T variant="small">
                Factor: {preview.factor?.variantLabel} · {BOUNDARY_LABELS[preview.factor!.boundary]} · {preview.factor?.sourceOrg}
              </T>
              {preview.factor?.isRegionalProxy ? <ValueBadge kind="proxy" /> : null}
            </>
          ) : (
            <T variant="small">{[...preview.warnings, ...preview.errors].join(' ')}</T>
          )}
          {preview.status === 'calculated'
            ? preview.warnings.map((w) => (
                <T key={w} variant="small" muted>• {w}</T>
              ))
            : null}
        </Card>
      ) : null}

      {validation?.warnings.map((w) => <Banner key={w} tone="warning" icon="warning" title="Please check" body={w} />)}
      {submitError ? <Banner tone="danger" icon="alert-circle" title="Could not save" body={submitError} /> : null}

      <Button
        title={submitLabel}
        icon="checkmark"
        loading={saving}
        disabled={!input || !validation?.ok || !!durationError}
        onPress={async () => {
          if (!input) return;
          setSaving(true);
          setSubmitError(null);
          try {
            await onSubmit(input);
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setSaving(false);
          }
        }}
      />
      {!v.mode ? <T variant="small" style={{ color: c.textMuted }}>Choose a transport mode to continue.</T> : null}
    </View>
  );
}
