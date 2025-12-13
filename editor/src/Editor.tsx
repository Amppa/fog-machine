import { ControlMode, MapController } from "./utils/MapController";
import { useEffect, useState } from "react";
const ERASER_DIAMETERS = [1, 3, 9, 31]; // Eraser diameter in fog pixels
import Mousetrap from "mousetrap";
import MainMenu from "./MainMenu";
import FlyToDialog from "./components/FlyToDialog";
import { ReactComponent as IconFlyTo } from "./assets/svg/pin.svg";
import { ReactComponent as IconRedo } from "./assets/svg/redo.svg";
import { ReactComponent as IconUndo } from "./assets/svg/undo.svg";
import { ReactComponent as IconPencil } from "./assets/svg/pencil.svg";
import { ReactComponent as IconPencilScribble } from "./assets/svg/pencil-scribble.svg";
import { ReactComponent as IconEraser } from "./assets/svg/eraser.svg";
import { ReactComponent as IconEraserSquare } from "./assets/svg/eraser-square.svg";
import { ReactComponent as IconEraserBlocks } from "./assets/svg/earser-3blocks.svg";
import { ReactComponent as IconEraserScribble } from "./assets/svg/earser-scribble.svg";

type Props = {
  setLoaded(isLoaded: boolean): void;
  mapController: MapController;
  msgboxShow(title: string, msg: string): void;
};

function Editor(props: Props): JSX.Element {
  const mapController = props.mapController;
  const [controlMode, setControlMode] = useState(ControlMode.View);
  useEffect(() => {
    mapController.setControlMode(controlMode);
  }, [controlMode]);

  const [historyStatus, setHistoryStatus] = useState({
    canRedo: false,
    canUndo: false,
  });

  const [eraserSize, setEraserSize] = useState(
    mapController.getDelPixelSize()
  );
  const [isDeletingPixel, setIsDeletingPixel] = useState(false);

  const [isFlyToDialogOpen, setIsFlyToDialogOpen] = useState(false);

  useEffect(() => {
    mapController.registerOnChangeCallback("editor", () => {
      setHistoryStatus({
        canRedo: mapController.historyManager.canRedo(),
        canUndo: mapController.historyManager.canUndo(),
      });
      setEraserSize(mapController.getDelPixelSize());
      setIsDeletingPixel(mapController.isDelPixelDrawing());
    });
    props.setLoaded(true);

    return function cleanup() {
      mapController.unregisterOnChangeCallback("editor");
    };
  }, []);

  Mousetrap.bind(["mod+z"], (_) => mapController.undo());
  Mousetrap.bind(["mod+shift+z"], (_) => mapController.redo());
  Mousetrap.bind(["b"], (_) => mapController.toggleGrid());

  const toggleMode = (modeToToggle: ControlMode) => {
    setControlMode(controlMode !== modeToToggle ? modeToToggle : ControlMode.View);
  };

  const toolButtons = [
    {
      key: "move-map",
      icon: <IconFlyTo className="w-full h-full" />,
      clickable: true,
      enabled: false,
      onClick: () => setIsFlyToDialogOpen(true),
    },
    {
      key: "undo",
      icon: <IconUndo className="w-full h-full" />,
      clickable: historyStatus.canUndo,
      enabled: false,
      onClick: () => mapController.undo(),
    },
    {
      key: "redo",
      icon: <IconRedo className="w-full h-full" />,
      clickable: historyStatus.canRedo,
      enabled: false,
      onClick: () => mapController.redo(),
    },
    null,
    {
      key: "line",
      icon: <IconPencil className="w-full h-full" />,
      clickable: true,
      enabled: controlMode === ControlMode.DrawPolyline,
      onClick: () => toggleMode(ControlMode.DrawPolyline),
    },
    {
      key: "scribbleLine",
      icon: <IconPencilScribble className="w-full h-full" />,
      clickable: true,
      enabled: controlMode === ControlMode.DrawScribble,
      onClick: () => toggleMode(ControlMode.DrawScribble)
    },
    {
      key: "eraser",
      icon: <IconEraserSquare className="w-full h-full" />,
      clickable: true,
      enabled: controlMode === ControlMode.DelRect,
      onClick: () => toggleMode(ControlMode.DelRect),
    },
    {
      key: "deleteBlock",
      icon: <IconEraserBlocks className="w-full h-full" />,
      clickable: true,
      enabled: controlMode === ControlMode.DelBlock,
      onClick: () => toggleMode(ControlMode.DelBlock)
    },
    {
      key: "deletePixel",
      icon: <IconEraserScribble className="w-full h-full" />,
      clickable: true,
      enabled: controlMode === ControlMode.DelPixel,
      onClick: () => toggleMode(ControlMode.DelPixel)
    },
  ];

  return (
    <>
      <MainMenu
        mapController={mapController}
        msgboxShow={props.msgboxShow}
        mode="editor"
      />

      <FlyToDialog
        mapController={mapController}
        isOpen={isFlyToDialogOpen}
        setIsOpen={setIsFlyToDialogOpen}
      />

      <div className="absolute bottom-0 pb-4 z-10 pointer-events-none flex justify-center w-full">
        {toolButtons.map((toolButton) =>
          toolButton !== null ? (
            <div key={toolButton.key} className="relative flex flex-col items-center justify-end">

              {toolButton.key === "deletePixel" &&
                controlMode === ControlMode.DelPixel &&
                !isDeletingPixel ? (
                <div className="absolute bottom-full mb-3 bg-white shadow-lg rounded-lg p-1 flex space-x-1 pointer-events-auto ring-1 ring-gray-200">
                  {ERASER_DIAMETERS.map((diameter, index) => (
                    <div
                      key={index}
                      className={
                        "flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 cursor-pointer" +
                        (eraserSize === diameter
                          ? " bg-gray-200 ring-2 ring-gray-400"
                          : "")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        mapController.setDelPixelSize(diameter);
                      }}
                    >
                      <div
                        className="bg-gray-800 rounded-full"
                        style={{
                          width: `${4 + index * 3}px`,
                          height: `${4 + index * 3}px`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                className={
                  "flex items-center justify-center mx-2 w-9 h-9 p-2 bg-white shadow rounded-lg hover:bg-gray-200 active:bg-gray-400" +
                  (toolButton.enabled ? " ring-4 ring-gray-700" : "") +
                  (toolButton.clickable
                    ? " pointer-events-auto"
                    : " text-gray-300 opacity-40")
                }
                onClick={() => {
                  if (toolButton.clickable) {
                    toolButton.onClick();
                  }
                }}
              >
                {toolButton.icon}
              </button>
            </div>
          ) : (
            <div
              key="|"
              className={
                "flex items-center justify-center rounded mx-2 w-1 h-9 bg-black shadow"
              }
            ></div>
          )
        )}
      </div>
    </>
  );
}

export default Editor;