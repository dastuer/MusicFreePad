import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setupNativeStatusBar } from "./core/native";
import { setupSystemBack } from "./core/systemBack";
import "./styles/global.css";

void setupNativeStatusBar();
setupSystemBack();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
