import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';
import { Button, Row } from './components';

/** Trip start date/time picker (native). The web build uses DateTimeField.web.tsx. */
export function DateTimeField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  function openAndroidPicker(mode: 'date' | 'time') {
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour: true,
      maximumDate: mode === 'date' ? new Date() : undefined,
      onChange: (_e, d) => d && onChange(d),
    });
  }

  if (Platform.OS === 'android') {
    return (
      <Row>
        <Button title={value.toLocaleDateString('en-GB')} icon="calendar" variant="secondary" onPress={() => openAndroidPicker('date')} />
        <Button title={value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} icon="time" variant="secondary" onPress={() => openAndroidPicker('time')} />
      </Row>
    );
  }
  return <DateTimePicker value={value} mode="datetime" display="compact" maximumDate={new Date()} onChange={(_e, d) => d && onChange(d)} accessibilityLabel="Trip start date and time" />;
}
