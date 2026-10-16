/**
 * Web build of the trip start picker: the browser's native `datetime-local` input (keyboard accessible,
 * mobile browsers show their own picker). The value is in the browser's local time, like the native app.
 */
import { createElement, useState } from 'react';
import { View } from 'react-native';
import { T } from './components';
import { font, MIN_TOUCH, radius, spacing, usePalette } from './theme';

const pad = (n: number) => String(n).padStart(2, '0');
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateTimeField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const c = usePalette();
  const [invalid, setInvalid] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <T variant="label">START DATE AND TIME</T>
      {createElement('input', {
        type: 'datetime-local',
        value: toLocalInput(value),
        max: toLocalInput(new Date()),
        'aria-label': 'Trip start date and time',
        onChange: (e: { target: { value: string } }) => {
          const d = new Date(e.target.value);
          const ok = e.target.value !== '' && !Number.isNaN(d.getTime());
          setInvalid(!ok);
          if (ok) onChange(d);
        },
        style: {
          minHeight: MIN_TOUCH,
          border: `1px solid ${invalid ? c.danger : c.border}`,
          borderRadius: radius.md,
          padding: `0 ${spacing.md}px`,
          fontSize: font.body,
          color: c.text,
          backgroundColor: c.surface,
          colorScheme: c.bg === '#0F1512' ? 'dark' : 'light',
          fontFamily: 'inherit',
        },
      })}
      {invalid ? <T variant="small" style={{ color: c.danger }}>Enter a complete date and time.</T> : null}
    </View>
  );
}
