import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { Separator } from '@/components/separator';
import { StatusRow } from '@/components/status-row';

export function ConnectScreen() {
  return (
    <Screen>
      <Section eyebrow="BLE" title="장치 연결">
        <StatusRow
          label="스캔"
          value="대기"
          description="Drunksafe 보드 notify를 받을 준비가 됐습니다."
        />
        <StatusRow
          label="연결"
          value="미연결"
          description="연결되면 측정 context를 보낼 수 있습니다."
        />
        <StatusRow
          label="Context"
          value="필요"
          description="baseline과 최근 히스토리가 아직 없습니다."
          tone="caution"
        />
      </Section>

      <Section eyebrow="Context" title="개인화 준비">
        <StatusRow
          label="Sober baseline"
          value="미측정"
          description="완전 sober 상태에서 별도 세션으로 잡습니다."
        />
        <StatusRow
          label="최근 히스토리"
          value="0건"
          description="알코올 해소 추정에는 최근 기록이 필요합니다."
        />
        <StatusRow
          label="프로필"
          value="미입력"
          description="나이, 키, 몸무게, 성별은 앱 안에서만 보관합니다."
        />
      </Section>

      <Section eyebrow="최근 결과" title="마지막 측정">
        <StatusRow
          label="위험 단계"
          value="기록 없음"
          description="첫 baseline 측정 후 결과가 저장됩니다."
        />
        <StatusRow label="해소 예상" value="-" description="최근 히스토리가 쌓이면 계산합니다." />
      </Section>

      <Separator />

      <ActionLink href="/onboarding" label="온보딩 시작" />
      <ActionLink href="/measure/demo-session" label="측정 화면 미리보기" variant="secondary" />
      <ActionLink href="/history" label="히스토리 보기" variant="secondary" />
    </Screen>
  );
}
