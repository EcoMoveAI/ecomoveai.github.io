import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { Screen } from '@/ui/components';
import { TripForm } from '@/ui/TripForm';

export default function NewTrip() {
  const router = useRouter();
  const { prefs, addTrip } = useApp();
  const [start] = useState(() => {
    const d = new Date(Date.now() - 30 * 60000);
    d.setSeconds(0, 0);
    return d;
  });
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <TripForm
          initial={{ origin: '', destination: '', distanceKm: '', mode: null, variant: null, occupancy: prefs.defaultCarOccupancy, start, durationMin: '20', notes: '' }}
          prefs={prefs}
          submitLabel="Save trip"
          onSubmit={async (input) => {
            const trip = await addTrip(input);
            router.replace({ pathname: '/trip/[id]', params: { id: trip.id } });
          }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
