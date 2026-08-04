import ActionButton from '@/components/action-button';
import ActionLink from '@/components/action-link';
import Screen from '@/components/screen';
import Separator from '@/components/separator';
import ResultSummary from '@/features/result/summary';
import ResultSupport from '@/features/result/support';
import useResult, { type ResultOrigin } from '@/features/result/use-result';

export default function ResultRoute() {
  const result = useResult();
  const baseline = result.kind === 'baseline';

  return (
    <Screen>
      <ResultSummary result={result} />
      <ResultSupport result={result} />

      <Separator />

      <ActionButton
        label={actionLabel(result.origin, result.saved, baseline)}
        disabled
        onPress={() => {}}
      />
      <ActionLink
        href={baseline ? '/onboarding' : '/history'}
        label={baseline ? '온보딩에서 baseline 확인' : '히스토리에 저장된 기록 보기'}
      />
      <ActionLink href="/" label="연결 화면으로 돌아가기" variant="secondary" />
    </Screen>
  );
}

function actionLabel(origin: ResultOrigin, saved: boolean, baseline: boolean) {
  if (origin === 'live') return saved ? '결과 저장 완료' : '결과 저장 실패';
  if (origin === 'saved') return '저장된 결과';
  return baseline ? '실측 Baseline만 저장' : '실측 결과만 저장';
}
