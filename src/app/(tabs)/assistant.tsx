import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { isCloudConfigured } from '@/config';
import { ApiError, askAgent } from '@/services/api';
import { newId } from '@/services/ids';
import { useApp } from '@/state/AppProvider';
import { useOnline } from '@/state/useOnline';
import { Banner, Button, Card, Chip, CONTENT_MAX_WIDTH, Row, Screen, T } from '@/ui/components';
import { MIN_TOUCH, radius, spacing, usePalette } from '@/ui/theme';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: { name: string; ok: boolean }[];
  error?: boolean;
}

const SUGGESTIONS = [
  'Why was my carbon footprint higher this month?',
  'Which transport mode contributes most to my emissions?',
  'What if I replace my taxi trips to campus with MRT next month?',
  'Find the lowest-carbon way to get to campus tomorrow, but no more than 15 minutes longer than driving.',
  'How much of my footprint comes from short car or scooter trips?',
];

const TOOL_LABELS: Record<string, string> = {
  get_trip_history: 'trip history',
  get_emissions_summary: 'emissions summary',
  get_emission_factors: 'emission factors',
  calculate_trip_emissions: 'calculator',
  compare_periods: 'period comparison',
  get_route_options: 'route options',
  compare_transport_modes: 'mode comparison',
  simulate_mobility_scenario: 'scenario simulation',
  generate_sustainability_insight: 'insights engine',
  get_user_preferences: 'your preferences',
};

const FALLBACK_HINT = 'Insights, Scenarios and Methodology work without the assistant.';

function llmErrorText(kind: string | undefined): string {
  switch (kind) {
    case 'quota':
      return `The AI provider's usage quota is used up for now (free-tier limits reset over time). ${FALLBACK_HINT}`;
    case 'rate_limited':
      return `The AI provider is receiving too many requests right now. Please wait a minute and try again. ${FALLBACK_HINT}`;
    case 'auth':
      return `The server's AI provider key was rejected. The app owner needs to check GEMINI_API_KEY. ${FALLBACK_HINT}`;
    case 'timeout':
      return `The AI provider took too long to answer. Try a shorter or more specific question. ${FALLBACK_HINT}`;
    default:
      return `The AI assistant is temporarily unavailable. ${FALLBACK_HINT}`;
  }
}

export default function AssistantScreen() {
  const router = useRouter();
  const c = usePalette();
  const { cloudActive, sync, syncNow } = useApp();
  const online = useOnline();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);

  if (!cloudActive) {
    return (
      <Screen>
        <Banner
          tone="info"
          icon="sparkles"
          title="The AI assistant needs an account"
          body={
            isCloudConfigured
              ? 'The assistant runs on the EcoMove server so the AI provider key never reaches your device. Sign in to use it.'
              : 'This build has no backend configured, so the AI assistant is unavailable. Everything else works on your device.'
          }
          action={isCloudConfigured ? <Button title="Sign in" variant="ghost" onPress={() => router.push('/auth')} /> : undefined}
        />
        <Card>
          <T variant="title">Available without the assistant</T>
          <T variant="small">The same deterministic calculations the assistant uses are available directly:</T>
          <Button title="Insights & period comparisons" icon="stats-chart" variant="secondary" onPress={() => router.push('/insights')} />
          <Button title="What-if scenarios & mode comparison" icon="git-compare" variant="secondary" onPress={() => router.push('/scenario')} />
          <Button title="Methodology & emission factors" icon="book" variant="secondary" onPress={() => router.push('/methodology')} />
        </Card>
      </Screen>
    );
  }

  async function send(content: string) {
    const q = content.trim();
    if (!q || busy) return;
    const userMsg: Msg = { id: newId(), role: 'user', content: q };
    const history = [...messages.filter((m) => !m.error), userMsg];
    setMessages((m) => [...m, userMsg]);
    setText('');
    setBusy(true);
    try {
      if (sync.pending) await syncNow(); // the assistant reads synced trips
      const res = await askAgent(history.map((m) => ({ role: m.role, content: m.content })));
      const failed = res.status === 'llm_error';
      setMessages((m) => [...m, { id: newId(), role: 'assistant', content: failed ? llmErrorText(res.errorKind) : res.reply, tools: res.tools, error: failed }]);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.code === 'llm_not_configured'
            ? `The AI provider is not configured on the server yet (GEMINI_API_KEY). ${FALLBACK_HINT}`
            : e.code === 'rate_limited'
              ? `You have reached the hourly assistant limit. Please try again later. ${FALLBACK_HINT}`
              : `${e.message} ${FALLBACK_HINT}`
          : `The assistant could not be reached. Check your connection. ${FALLBACK_HINT}`;
      setMessages((m) => [...m, { id: newId(), role: 'assistant', content: msg, error: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' }}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {!online ? (
              <Banner tone="info" icon="cloud-offline" title="You're offline" body={`The assistant needs an internet connection. ${FALLBACK_HINT}`} />
            ) : null}
            <T variant="small" muted>
              Answers are built from tools that read your synced trips and EcoMove's calculation engine. The AI explains results; it does not calculate emissions itself. It can still make mistakes — check important numbers in Insights and Methodology.
            </T>
            {messages.length === 0 ? (
              <View style={{ gap: spacing.sm }}>
                <T variant="label">TRY ASKING</T>
                {SUGGESTIONS.map((s) => (
                  <Chip key={s} label={s} onPress={() => send(s)} />
                ))}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View
            accessible
            accessibilityLabel={`${item.role === 'user' ? 'You' : 'Assistant'}: ${item.content}`}
            style={{
              alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              backgroundColor: item.role === 'user' ? c.primary : item.error ? c.warningSoft : c.surface,
              borderColor: c.border,
              borderWidth: item.role === 'user' ? 0 : 0.5,
              borderRadius: radius.lg,
              padding: spacing.md,
              gap: 6,
            }}
          >
            <T style={{ color: item.role === 'user' ? c.primaryText : c.text }} selectable>{item.content}</T>
            {item.tools?.length ? (
              <T variant="small" muted>
                {`Used: ${[...new Set(item.tools.map((t) => TOOL_LABELS[t.name] ?? t.name))].join(', ')}${item.tools.some((t) => !t.ok) ? ' (some tools failed — see the answer for limitations)' : ''}`}
              </T>
            ) : null}
          </View>
        )}
        ListFooterComponent={busy ? (
          <Row>
            <ActivityIndicator color={c.primary} />
            <T variant="small" muted>Analysing your trips…</T>
          </Row>
        ) : null}
      />
      <Row style={{ padding: spacing.md, borderTopWidth: 0.5, borderColor: c.border, backgroundColor: c.surface }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask about your mobility footprint…"
          placeholderTextColor={c.textMuted}
          accessibilityLabel="Message to the assistant"
          multiline
          maxLength={1000}
          style={{ flex: 1, minHeight: MIN_TOUCH, maxHeight: 120, color: c.text, backgroundColor: c.bg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingTop: 12 }}
        />
        <Button title="Send" icon="send" onPress={() => send(text)} disabled={!text.trim() || busy || !online} />
      </Row>
      {messages.length ? (
        <View style={{ backgroundColor: c.surface, paddingBottom: spacing.sm, alignItems: 'center' }}>
          <Button title="New conversation" variant="ghost" onPress={() => setMessages([])} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
