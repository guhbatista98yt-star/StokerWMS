
import { usePickingStore } from "@/lib/pickingStore";
import { PickingLayout } from "@/components/handheld/PickingLayout";
import { PickingList } from "@/components/handheld/PickingList";
import { PickingSession } from "@/components/handheld/PickingSession";

export default function PickingPage() {
    const { activeSession } = usePickingStore();

    return (
        <PickingLayout>
            {activeSession ? (
                <PickingSession />
            ) : (
                <PickingList />
            )}
        </PickingLayout>
    );
}
