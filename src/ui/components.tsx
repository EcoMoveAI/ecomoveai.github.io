import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MODE_INFO } from '@core/modes.ts';
import type { TransportMode } from '@core/types.ts';
import { font, MIN_TOUCH, radius, spacing, usePalette } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true, edges = ['bottom'] }: { children: React.ReactNode; scroll?: boolean; edges?: ('top' | 'bottom')[] }) {
  const c = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'default' | 'warning' | 'info' | 'danger' | 'primary' }) {
  const c = usePalette();
  const bg = tone === 'warning' ? c.warningSoft : tone === 'info' ? c.infoSoft : tone === 'danger' ? c.dangerSoft : tone === 'primary' ? c.primarySoft : c.surface;
  return <View style={[styles.card, { backgroundColor: bg, borderColor: c.border }, style]}>{children}</View>;
}

export function T({
  children,
  variant = 'body',
  muted,
  style,
  numberOfLines,
  selectable,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  variant?: 'display' | 'h1' | 'h2' | 'title' | 'body' | 'small' | 'label';
  muted?: boolean;
  style?: StyleProp<import('react-native').TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  accessibilityLabel?: string;
}) {
  const c = usePalette();
  const v = {
    display: { fontSize: font.display, fontWeight: '700' as const },
    h1: { fontSize: font.h1, fontWeight: '700' as const },
    h2: { fontSize: font.h2, fontWeight: '700' as const },
    title: { fontSize: font.title, fontWeight: '600' as const },
    body: { fontSize: font.body },
    small: { fontSize: font.small },
    label: { fontSize: font.small, fontWeight: '600' as const, letterSpacing: 0.3 },
  }[variant];
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={variant === 'h1' || variant === 'h2' ? 'header' : undefined}
      style={[v, { color: muted ? c.textMuted : c.text }, style]}
    >
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  accessibilityHint,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = usePalette();
  const colors = {
    primary: { bg: c.primary, fg: c.primaryText, border: c.primary },
    secondary: { bg: c.surface, fg: c.primary, border: c.primary },
    ghost: { bg: 'transparent', fg: c.primary, border: 'transparent' },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.danger },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.fg} /> : icon ? <Ionicons name={icon} size={18} color={colors.fg} /> : null}
      <Text style={{ color: colors.fg, fontSize: font.body, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.primary : c.surface, borderColor: selected ? c.primary : c.border }]}
    >
      {icon ? <Ionicons name={icon} size={16} color={selected ? c.primaryText : c.text} /> : null}
      <Text style={{ color: selected ? c.primaryText : c.text, fontSize: font.small, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function ModeIcon({ mode, size = 20, color }: { mode: TransportMode; size?: number; color?: string }) {
  const c = usePalette();
  return <Ionicons name={MODE_INFO[mode].icon as IconName} size={size} color={color ?? c.text} accessibilityElementsHidden importantForAccessibility="no" />;
}

export function ModePicker({ value, onChange, modes }: { value: TransportMode | null; onChange: (m: TransportMode) => void; modes: TransportMode[] }) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {modes.map((m) => (
        <Chip key={m} label={MODE_INFO[m].label} icon={MODE_INFO[m].icon as IconName} selected={value === m} onPress={() => onChange(m)} />
      ))}
    </View>
  );
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const c = usePalette();
  return (
    <View style={{ gap: 4 }}>
      <T variant="label">{label}</T>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={c.textMuted}
        style={[styles.input, { borderColor: error ? c.danger : c.border, color: c.text, backgroundColor: c.surface }]}
        {...props}
      />
      {error ? <T variant="small" style={{ color: c.danger }}>{error}</T> : hint ? <T variant="small" muted>{hint}</T> : null}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, style]}>{children}</View>;
}

export function ListItem({ title, subtitle, icon, onPress, right }: { title: string; subtitle?: string; icon?: IconName; onPress?: () => void; right?: React.ReactNode }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.listItem, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
    >
      {icon ? <Ionicons name={icon} size={22} color={c.primary} /> : null}
      <View style={{ flex: 1 }}>
        <T variant="body" style={{ fontWeight: '600' }}>{title}</T>
        {subtitle ? <T variant="small" muted>{subtitle}</T> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={c.textMuted} /> : null)}
    </Pressable>
  );
}

export function Banner({ tone, icon, title, body, action }: { tone: 'warning' | 'info' | 'danger' | 'primary'; icon: IconName; title: string; body?: string; action?: React.ReactNode }) {
  const c = usePalette();
  const fg = tone === 'warning' ? c.warning : tone === 'danger' ? c.danger : tone === 'info' ? c.info : c.primary;
  return (
    <Card tone={tone}>
      <Row style={{ alignItems: 'flex-start' }}>
        <Ionicons name={icon} size={22} color={fg} />
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="body" style={{ fontWeight: '700' }}>{title}</T>
          {body ? <T variant="small">{body}</T> : null}
          {action}
        </View>
      </Row>
    </Card>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: React.ReactNode }) {
  const c = usePalette();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
      <Ionicons name={icon} size={40} color={c.textMuted} />
      <T variant="title" style={{ textAlign: 'center' }}>{title}</T>
      <T muted style={{ textAlign: 'center' }}>{body}</T>
      {action}
    </View>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 100, gap: 2 }}>
      <T variant="small" muted>{label}</T>
      <T variant="title">{value}</T>
      {sub ? <T variant="small" muted>{sub}</T> : null}
    </Card>
  );
}

/** Small pill marking how a value was produced (recorded / estimate / simulated / sample). */
export function ValueBadge({ kind }: { kind: 'recorded' | 'estimate' | 'simulated' | 'pending' | 'synced' | 'review' | 'proxy' }) {
  const c = usePalette();
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    recorded: { label: 'RECORDED', bg: c.primarySoft, fg: c.primary },
    estimate: { label: 'ESTIMATE', bg: c.infoSoft, fg: c.info },
    simulated: { label: 'SIMULATED', bg: c.warningSoft, fg: c.warning },
    pending: { label: 'NOT SYNCED', bg: c.warningSoft, fg: c.warning },
    synced: { label: 'SYNCED', bg: c.primarySoft, fg: c.primary },
    review: { label: 'NEEDS REVIEW', bg: c.warningSoft, fg: c.warning },
    proxy: { label: 'PROXY FACTOR', bg: c.infoSoft, fg: c.info },
  };
  const m = map[kind];
  return (
    <View style={{ backgroundColor: m.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: m.fg, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>{m.label}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const c = usePalette();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surfaceAlt }]} accessibilityRole="tablist">
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: sel }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, sel && { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Text style={{ color: sel ? c.text : c.textMuted, fontWeight: sel ? '700' : '500', fontSize: font.small }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider() {
  const c = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: spacing.sm }} />;
}

export function Loading() {
  const c = usePalette();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      <ActivityIndicator color={c.primary} size="large" accessibilityLabel="Loading" />
    </View>
  );
}

/** Content column width on large screens (tablet/desktop browsers); phones use the full width. */
export const CONTENT_MAX_WIDTH = 760;

const styles = StyleSheet.create({
  screenContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.sm },
  button: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: { minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: font.body },
  listItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
});
