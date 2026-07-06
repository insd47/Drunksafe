import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { Separator } from '@/components/separator';
import { StatusRow } from '@/components/status-row';

export function ResultScreen() {
  return (
    <Screen>
      <Section eyebrow="Result" title="운전 금지">
        <StatusRow
          label="위험 단계"
          value="위험"
          description="보수적 BAC 상한 기준으로 판단했습니다."
          tone="danger"
        />
        <StatusRow label="호기 알코올" value="0.080 mg/L" />
        <StatusRow label="BAC 추정" value="0.038%" />
        <StatusRow label="BAC 상한" value="0.046%" tone="danger" />
        <StatusRow
          label="해소 예상"
          value="2시간 10분"
          description="최근 히스토리 기준 추정값입니다."
        />
        <StatusRow label="신뢰도" value="82%" />
      </Section>

      <Section eyebrow="Pulse" title="보조 지표">
        <StatusRow label="심박수" value="92 BPM" />
        <StatusRow label="품질" value="안정" tone="safe" />
      </Section>

      <Separator />

      <ActionLink href="/history" label="히스토리에 저장된 기록 보기" />
      <ActionLink href="/" label="연결 화면으로 돌아가기" variant="secondary" />
    </Screen>
  );
}
