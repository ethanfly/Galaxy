// Crash recovery choice: restore last workspace or clean start (§8).
import { useState } from "react";

import { recoveryCleanStart, workspaceRestore } from "../../shared/ipc/client";
import { useUiStore } from "../../shared/stores/uiStore";
import { useAppStore } from "../../shared/stores/appStore";
import { Modal } from "../../shared/components/Modal";
import { t } from "../../shared/i18n";

export function RecoveryDialog() {
  const open = useUiStore((s) => s.recoveryDialogOpen);
  const close = useUiStore((s) => s.closeRecovery);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const choose = async (restore: boolean) => {
    setBusy(true);
    try {
      if (restore) {
        await workspaceRestore();
        await useAppStore.getState().refreshSessions();
      } else {
        await recoveryCleanStart();
        await useAppStore.getState().refreshSessions();
      }
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <Modal title={`⚠ ${t("crashTitle")}`} onClose={() => void choose(true)} width={480}>
      <div className="modal-body">
        <p style={{ color: "var(--text-md)", marginTop: 0 }}>{t("crashBody")}</p>
      </div>
      <div className="modal-footer">
        <button className="btn" disabled={busy} onClick={() => void choose(false)}>
          {t("cleanStart")}
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void choose(true)}>
          {t("restoreWorkspace")}
        </button>
      </div>
    </Modal>
  );
}
