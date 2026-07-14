"use client";

import { useState } from "react";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import Box from "@mui/material/Box";

interface PermissionGateProps {
  onReady: (micEnabled: boolean) => void;
}

export default function PermissionGate({ onReady }: PermissionGateProps) {
  const [state, setState] = useState<"idle" | "loading" | "denied">("idle");

  const handleEnableMic = async () => {
    setState("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      onReady(true);
    } catch {
      setState("denied");
    }
  };

  const handleSkipMic = () => {
    onReady(false);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
            Microphone Access
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            This exam monitors your audio to ensure exam integrity. Please enable your microphone
            before starting. You can skip this step, but it will be logged as a violation.
          </Typography>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={state === "loading" ? <CircularProgress size={20} color="inherit" /> : <MicIcon />}
              disabled={state === "loading"}
              onClick={handleEnableMic}
            >
              {state === "loading" ? "Requesting Access..." : "Enable Microphone"}
            </Button>

            {state === "denied" && (
              <Typography variant="body2" color="error">
                Microphone access was denied. You can still start the exam, but this will be
                logged.
              </Typography>
            )}

            <Button variant="outlined" size="large" onClick={handleSkipMic}>
              Skip — Start Without Microphone
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
