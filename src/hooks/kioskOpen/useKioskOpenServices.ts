import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useGetAllPipelineStatusMutation } from "@cx-sdk/catalog/services/kioskOpenApi";
import {
  selectPipelineStatuses,
  setPipelineStatuses,
} from "@cx-sdk/catalog/state/kioskOpenStatus.slice";

interface PipelineOpenState {
  status: boolean;
  reason: string;
}

/**
 * Per-pipeline open/closed state (P4 subset of posistKiosk's
 * useKioskOpenServices — the StartScreen whole-kiosk check arrives with its
 * screen). Statuses land in @cx-sdk kioskOpenStatus.slice; absence of an
 * entry means OPEN (fork parity).
 */
const useKioskOpenServices = () => {
  const dispatch = useDispatch();
  const [getAllPipelineStatusApi] = useGetAllPipelineStatusMutation();
  const pipelineStatuses = useSelector(selectPipelineStatuses);

  const checkPipelineClosedFromRedux = useCallback(
    (pipelineId: string): PipelineOpenState => {
      const entry = pipelineStatuses?.[pipelineId];
      if (!entry) {
        return { status: true, reason: "" };
      }
      return { status: entry.status === true, reason: entry?.reason ?? "" };
    },
    [pipelineStatuses]
  );

  const checkAllPipelinesWithIds = useCallback(
    async (pipelineIds: string[]) => {
      try {
        const results = await getAllPipelineStatusApi({
          name: "Kiosk",
          app: "kiosk",
          pipeline_ids: pipelineIds,
        }).unwrap();
        dispatch(setPipelineStatuses(results));
        return results;
      } catch (error) {
        console.error("Error checking pipelines:", error);
        return false;
      }
    },
    [getAllPipelineStatusApi, dispatch]
  );

  return {
    pipelineStatuses,
    checkPipelineClosedFromRedux,
    checkAllPipelinesWithIds,
  };
};

export default useKioskOpenServices;
