import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { evaluateGoal, GOAL_META, GOAL_TYPES, validateGoal, type GoalType } from '@core/goals.ts';
import { useApp } from '@/state/AppProvider';
import { useNow } from '@/state/useNow';
import { Banner, Button, Card, Chip, EmptyState, Field, Row, Screen, Segmented, T } from '@/ui/components';
import { confirmAction } from '@/ui/dialogs';
import { radius, usePalette } from '@/ui/theme';

const STATUS_LABEL = { on_track: 'On track', at_risk: 'Behind pace', achieved: 'Achieved', not_met: 'Not met', insufficient_data: 'Needs more history' } as const;

export default function GoalsScreen() {
  const c = usePalette();
  const now = useNow();
  const { goals, trips, prefs, saveGoal, deleteGoal } = useApp();
  const [type, setType] = useState<GoalType>('reduce_emissions_pct');
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [target, setTarget] = useState('10');
  const [error, setError] = useState<string | null>(null);

  const progress = useMemo(() => goals.filter((g) => g.status !== 'archived').map((g) => evaluateGoal(g, trips, now, prefs.timeZone)), [goals, trips, now, prefs.timeZone]);
  const targetNum = Number(target);
  const errors = validateGoal({ type, targetValue: targetNum, period });

  return (
    <Screen>
      <T variant="small" muted>Goals are personal targets you choose. They are compared with your own history, not with scientific or official thresholds, and necessary trips are never "failures".</T>
      {progress.length === 0 ? <EmptyState icon="flag" title="No goals yet" body="Set an optional goal below." /> : null}
      {progress.map((p) => (
        <Card key={p.goal.id} tone={p.status === 'achieved' ? 'primary' : p.status === 'at_risk' ? 'warning' : 'default'}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="title" style={{ flex: 1 }}>{GOAL_META[p.goal.type].describe(p.goal.targetValue)}</T>
            <T variant="small" style={{ fontWeight: '700' }}>{STATUS_LABEL[p.status]}</T>
          </Row>
          <T variant="small" muted>{`This ${p.goal.period} (${p.periodKey}) · ${Math.round(p.elapsedFraction * 100)}% of the ${p.goal.period} elapsed`}</T>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(p.progress * 100) }}
            style={{ height: 8, backgroundColor: c.surfaceAlt, borderRadius: radius.pill, overflow: 'hidden' }}
          >
            <View style={{ height: 8, width: `${Math.round(p.progress * 100)}%`, backgroundColor: p.status === 'at_risk' || p.status === 'not_met' ? c.warning : c.primary }} />
          </View>
          <T variant="small">{p.message}</T>
          {p.baselineKg != null ? <T variant="small" muted>Baseline: average of your last {p.baselinePeriods} {p.goal.period}(s) with trips.</T> : null}
          <Row>
            <Button
              title={p.goal.status === 'paused' ? 'Resume' : 'Pause'}
              variant="ghost"
              onPress={() => void saveGoal({ ...p.goal, status: p.goal.status === 'paused' ? 'active' : 'paused' })}
            />
            <Button
              title="Delete"
              variant="ghost"
              onPress={async () => {
                if (await confirmAction({ title: 'Delete this goal?', confirmLabel: 'Delete', destructive: true })) void deleteGoal(p.goal.id);
              }}
            />
          </Row>
        </Card>
      ))}

      <Card>
        <T variant="title">Add a goal</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {GOAL_TYPES.map((t) => (
            <Chip
              key={t}
              label={GOAL_META[t].title}
              selected={type === t}
              onPress={() => {
                setType(t);
                setTarget(t === 'reduce_emissions_pct' ? '10' : t.startsWith('max_') ? '4' : '8');
              }}
            />
          ))}
        </Row>
        <Segmented value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
        <Field label={`Target (${GOAL_META[type].unit})`} value={target} onChangeText={setTarget} keyboardType="decimal-pad" error={target && errors.length ? errors[0] : null} />
        <T variant="small" muted>{GOAL_META[type].describe(Number.isFinite(targetNum) ? targetNum : 0)} per {period}.</T>
        {error ? <Banner tone="danger" icon="alert-circle" title={error} /> : null}
        <Button
          title="Save goal"
          icon="flag"
          disabled={errors.length > 0}
          onPress={async () => {
            setError(null);
            try {
              await saveGoal({ type, targetValue: targetNum, period, status: 'active' });
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not save.');
            }
          }}
        />
      </Card>
    </Screen>
  );
}
