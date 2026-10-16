import { useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { MODE_INFO } from '@core/modes.ts';
import { isValidTimeZone } from '@core/time.ts';
import { TRANSPORT_MODES, type TransportMode, type UserPreferences } from '@core/types.ts';
import { ensureNotificationPermission, notificationsNote, notificationsSupported } from '@/services/notifications';
import { useApp } from '@/state/AppProvider';
import { Banner, Button, Card, Chip, Field, Row, Screen, T, type IconName } from '@/ui/components';
import { usePalette } from '@/ui/theme';

const SELECTABLE: TransportMode[] = TRANSPORT_MODES.filter((m) => m !== 'unknown');

export default function PreferencesScreen() {
  const c = usePalette();
  const { prefs, setPreferences, settings, updateSettings } = useApp();
  const [draft, setDraft] = useState<UserPreferences>(prefs);
  const [extra, setExtra] = useState(prefs.maxExtraMinutes == null ? '' : String(prefs.maxExtraMinutes));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifError, setNotifError] = useState<string | null>(null);
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const toggle = (list: TransportMode[], m: TransportMode) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  const tzValid = isValidTimeZone(draft.timeZone);
  const extraNum = extra.trim() === '' ? null : Number(extra);
  const extraValid = extraNum == null || (Number.isInteger(extraNum) && extraNum >= 0 && extraNum <= 240);

  async function setNotif(key: keyof typeof settings.notifications, value: boolean) {
    setNotifError(null);
    if (value && !notificationsSupported) {
      setNotifError(
        Platform.OS === 'web'
          ? 'This browser does not support notifications. Your summaries are still available on the Home and Insights screens.'
          : 'Notifications are not available in Expo Go on Android. They work in an installed (development or release) build.',
      );
      return;
    }
    if (value && !(await ensureNotificationPermission())) {
      setNotifError(`Notifications are not allowed for EcoMove in ${Platform.OS === 'web' ? 'your browser settings' : 'system settings'}. Everything else keeps working.`);
      return;
    }
    await updateSettings({ notifications: { ...settings.notifications, [key]: value } });
  }

  return (
    <Screen>
      <Card>
        <T variant="title">Time zone</T>
        <Field label="IANA time zone" value={draft.timeZone} onChangeText={(t) => setDraft({ ...draft, timeZone: t.trim() })} autoCapitalize="none" error={tzValid ? null : 'Unknown time zone (e.g. Asia/Taipei).'} hint="Trips are assigned to days and months in this time zone." />
        {deviceTz && deviceTz !== draft.timeZone ? <Button title={`Use this ${Platform.OS === 'web' ? "device's" : "phone's"} time zone (${deviceTz})`} variant="ghost" onPress={() => setDraft({ ...draft, timeZone: deviceTz })} /> : null}
      </Card>

      <Card>
        <T variant="title">Vehicle occupancy defaults</T>
        <T variant="small" muted>Used for automatically detected trips. Car and scooter emissions are divided among occupants.</T>
        <Row>
          <T style={{ flex: 1 }}>Car: {draft.defaultCarOccupancy}</T>
          <Button title="−" variant="secondary" onPress={() => setDraft({ ...draft, defaultCarOccupancy: Math.max(1, draft.defaultCarOccupancy - 1) })} />
          <Button title="+" variant="secondary" onPress={() => setDraft({ ...draft, defaultCarOccupancy: Math.min(9, draft.defaultCarOccupancy + 1) })} />
        </Row>
        <Row>
          <T style={{ flex: 1 }}>Motorcycle/scooter: {draft.defaultMotorcycleOccupancy}</T>
          <Button title="−" variant="secondary" onPress={() => setDraft({ ...draft, defaultMotorcycleOccupancy: 1 })} />
          <Button title="+" variant="secondary" onPress={() => setDraft({ ...draft, defaultMotorcycleOccupancy: 2 })} />
        </Row>
      </Card>

      <Card>
        <T variant="title">Travel constraints for suggestions</T>
        <Field label="Maximum extra minutes vs. driving" value={extra} onChangeText={setExtra} keyboardType="number-pad" placeholder="e.g. 15" error={extraValid ? null : 'Enter 0–240 minutes or leave empty.'} />
        <T variant="label">PREFERRED MODES</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {SELECTABLE.map((m) => (
            <Chip key={m} label={MODE_INFO[m].label} icon={MODE_INFO[m].icon as IconName} selected={draft.preferredModes.includes(m)} onPress={() => setDraft({ ...draft, preferredModes: toggle(draft.preferredModes, m), avoidModes: draft.avoidModes.filter((x) => x !== m) })} />
          ))}
        </Row>
        <T variant="label">MODES TO AVOID</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {SELECTABLE.map((m) => (
            <Chip key={m} label={MODE_INFO[m].label} selected={draft.avoidModes.includes(m)} onPress={() => setDraft({ ...draft, avoidModes: toggle(draft.avoidModes, m), preferredModes: draft.preferredModes.filter((x) => x !== m) })} />
          ))}
        </Row>
        <Field
          label="Accessibility or other constraints (optional)"
          value={draft.accessibilityNotes ?? ''}
          onChangeText={(t) => setDraft({ ...draft, accessibilityNotes: t || null })}
          maxLength={500}
          multiline
          hint="Shared with the AI assistant so suggestions respect your needs, e.g. 'avoid stairs', 'cannot cycle'."
        />
      </Card>

      {error ? <Banner tone="danger" icon="alert-circle" title="Not saved" body={error} /> : null}
      {saved ? <Banner tone="primary" icon="checkmark-circle" title="Preferences saved" /> : null}
      <Button
        title="Save preferences"
        disabled={!tzValid || !extraValid}
        onPress={async () => {
          setError(null);
          setSaved(false);
          try {
            await setPreferences({ ...draft, maxExtraMinutes: extraNum });
            setSaved(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save.');
          }
        }}
      />

      <Card>
        <T variant="title">Notifications</T>
        <T variant="small" muted>Off by default. Notification text never includes places or trip details.</T>
        {(
          [
            ['dailySummary', 'Daily summary (21:00)'],
            ['weeklyInsight', 'Weekly insight (Monday 09:00)'],
            ['monthlyReport', 'Monthly report (1st of the month)'],
            ['goalProgress', 'Goal progress alerts'],
          ] as const
        ).map(([key, label]) => (
          <Row key={key} style={{ justifyContent: 'space-between', minHeight: 44 }}>
            <View style={{ flex: 1 }}>
              <T>{label}</T>
            </View>
            <Switch value={settings.notifications[key]} onValueChange={(v) => void setNotif(key, v)} trackColor={{ true: c.primary }} accessibilityLabel={label} />
          </Row>
        ))}
        {notificationsNote ? <T variant="small" muted>{notificationsNote}</T> : null}
        {notifError ? <T variant="small" style={{ color: c.warning }}>{notifError}</T> : null}
      </Card>
    </Screen>
  );
}
