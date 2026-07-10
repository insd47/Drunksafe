import ActionLink from '@/components/action-link';
import Screen from '@/components/screen';
import InsightSections from '@/features/history/insight';
import RecordSection from '@/features/history/records';
import useHistory from '@/features/history/use-history';

export default function HistoryRoute() {
  const history = useHistory();

  return (
    <Screen>
      {!history.failed ? <InsightSections records={history.records} /> : null}
      <RecordSection records={history.records} failed={history.failed} />
      <ActionLink href="/" label="장치 연결로 돌아가기" variant="secondary" />
    </Screen>
  );
}
