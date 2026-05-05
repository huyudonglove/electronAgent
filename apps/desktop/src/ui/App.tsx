import { useEffect, useState } from "react";
import type { ModelProfile } from "@xiaomi/shared";
import { MinimalChatPage } from "./MinimalChatPage";

export function App(): JSX.Element {
  const [modelProfiles, setModelProfiles] = useState<readonly ModelProfile[]>([]);

  useEffect(() => {
    window.workbench.getInitialState().then((state) => {
      setModelProfiles(state.modelProfiles);
    }).catch(() => {
      setModelProfiles([]);
    });
  }, []);

  return <MinimalChatPage modelProfiles={modelProfiles} />;
}
