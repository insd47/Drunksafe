import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';

const rows = [
  ['오늘 00:12', '주의', '0.038%'],
  ['어제 23:08', '위험', '0.072%'],
  ['07월 02일 21:40', '안전', '0.008%'],
] as const;

export function HistoryScreen() {
  return (
    <Screen>
      <Section eyebrow="History" title="최근 측정">
        {rows.map(([time, risk, bac]) => (
          <StatusRow
            key={time}
            label={time}
            value={bac}
            description={risk}
            tone={risk === '위험' ? 'danger' : risk === '주의' ? 'caution' : 'safe'}
          />
        ))}
      </Section>

      <ActionLink href="/" label="장치 연결로 돌아가기" variant="secondary" />
    </Screen>
  );
}
