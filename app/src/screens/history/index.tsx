import ActionLink from '@/components/action-link';
import Screen from '@/components/screen';
import InsightSections from '@/screens/history/_views/insight';
import RecordSection from '@/screens/history/_views/records';
import useHistory from '@/screens/history/use-history';

export default function HistoryScreen() {
  const history = useHistory();

  return (
    <Screen>
      {!history.failed ? <InsightSections records={history.records} /> : null}
      <RecordSection records={history.records} failed={history.failed} />
      <ActionLink href="/" label="장치 연결로 돌아가기" variant="secondary" />
    </Screen>
  );
}
