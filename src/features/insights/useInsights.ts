import { useCallback, useEffect, useRef, useState } from "react";

import { insightsSummary } from "../../shared/ipc/client";
import { onBlocksUpdated } from "../../shared/ipc/events";
import type { InsightsRange, InsightsSummary } from "../../shared/ipc/types";

type UseInsightsOptions = {
  projectId: string | null;
  range: InsightsRange;
};

export function useInsights({ projectId, range }: UseInsightsOptions) {
  const [data, setData] = useState<InsightsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<InsightsSummary | null>(null);
  const requestSequence = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const hasData = dataRef.current !== null;
    setLoading(!hasData);
    setRefreshing(hasData);
    setError(null);
    try {
      const next = await insightsSummary(projectId, range, new Date().getTimezoneOffset());
      if (sequence !== requestSequence.current) return;
      dataRef.current = next;
      setData(next);
    } catch (reason) {
      if (sequence !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [projectId, range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onBlocksUpdated(() => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => void refresh(), 200);
    }).then((dispose) => {
      if (cancelled) dispose();
      else unlisten = dispose;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [refresh]);

  return { data, loading, refreshing, error, refresh };
}
