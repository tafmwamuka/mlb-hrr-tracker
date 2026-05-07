import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { NotificationCenter } from "./components/NotificationCenter";
import { useNotifications } from "./contexts/NotificationContext";
import Home from "./pages/Home";
import Props from "./pages/Props";
import Favorites from "./pages/Favorites";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/props"} component={Props} />
      <Route path={"/favorites"} component={Favorites} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <NotificationProvider>
    <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
            <NotificationCenterWrapper />
        </TooltipProvider>
      </ThemeProvider>
    </NotificationProvider>
    </ErrorBoundary>
  );
}

export default App;

function NotificationCenterWrapper() {
  const { notifications, removeNotification } = useNotifications();
  return <NotificationCenter notifications={notifications} onDismiss={removeNotification} />;
}
