import { useState } from "react";
import GithubCorner from "./components/GithubCorner";
import { MapController } from "./utils/MapController";
import { useTranslation } from "react-i18next";
import BaseDialog from "./components/BaseDialog";
import Map from "./components/Map";
import Editor from "./Editor";
import Viewer from "./Viewer";

type ModeProps = {
  mapController: MapController | null;
  setLoaded(isLoaded: boolean): void;
  msgboxShow(title: string, msg: string): void;
};
function Mode(props: ModeProps) {
  if (!props.mapController) return <></>;
  const snapshotIdStr = new URL(window.location.href).searchParams.get("viewing-snapshot");
  if (snapshotIdStr) {
    const snapshotId = Number(snapshotIdStr);
    return (
      <Viewer
        mapController={props.mapController}
        setLoaded={props.setLoaded}
        initialSnapshotId={snapshotId}
        msgboxShow={props.msgboxShow}
      />
    );
  } else {
    return <Editor mapController={props.mapController} setLoaded={props.setLoaded} msgboxShow={props.msgboxShow} />;
  }
}

function App(): JSX.Element {
  const { t } = useTranslation();
  const t_ = (key: string | null) => {
    if (key) {
      return t(key);
    } else {
      return "";
    }
  };

  const [mapController, setmapController] = useState<MapController | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msgboxState, setMsgboxState] = useState<{
    isOpen: boolean;
    title: null | string;
    msg: null | string;
  }>({
    isOpen: false,
    title: null,
    msg: null,
  });

  const msgboxClose = () => {
    setMsgboxState({ ...msgboxState, isOpen: false });
  };

  const msgboxShow = (title: string, msg: string) => {
    setMsgboxState({ isOpen: true, title: title, msg: msg });
  };

  const msgbox = (
    <BaseDialog
      isOpen={msgboxState.isOpen}
      onClose={msgboxClose}
      title={t_(msgboxState.title)}
      zIndex={10}
      footer={
        <div className="mt-4">
          <button
            type="button"
            className="inline-flex justify-center px-4 py-2 text-sm font-medium text-blue-900 bg-blue-100 border border-transparent rounded-md hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
            onClick={msgboxClose}
          >
            OK
          </button>
        </div>
      }
    >
      <div className="mt-2">
        <p className="text-xs text-gray-500" style={{ whiteSpace: "pre-wrap" }}>
          {t_(msgboxState.msg)}
        </p>
      </div>
    </BaseDialog>
  );

  const loadingSpinner = (
    <div className="flex h-screen">
      <svg
        className="animate-spin h-12 w-12 m-auto text-black"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    </div>
  );

  return (
    <>
      <GithubCorner />
      <div className={loaded ? "" : "invisible"}>
        <Map
          note="THIS SHOULDN'T BE UNMOUNTED"
          initialized={(mapController) => {
            setmapController(mapController);
          }}
        />
      </div>
      {msgbox}
      <Mode mapController={mapController} setLoaded={setLoaded} msgboxShow={msgboxShow} />
      {loaded ? <></> : loadingSpinner}
    </>
  );
}

export default App;
