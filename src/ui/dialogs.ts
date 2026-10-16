/**
 * Cross-platform confirmation dialog. React Native's Alert.alert does nothing in the browser
 * (react-native-web has no implementation), so the web uses the browser's own confirm dialog.
 */
import { Alert, Platform } from 'react-native';

export function confirmAction(opts: { title: string; message?: string; confirmLabel: string; destructive?: boolean }): Promise<boolean> {
  if (Platform.OS === 'web') {
    const text = opts.message ? `${opts.title}\n\n${opts.message}` : opts.title;
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: opts.confirmLabel, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
