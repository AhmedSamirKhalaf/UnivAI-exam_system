"use client";

import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useRouter } from "next/navigation";

const rules = [
  "Do not switch browser tabs during the exam.",
  "Do not exit fullscreen mode once the exam starts.",
  "Do not open developer tools or any debugging utilities.",
  "Do not copy, paste, or use the right-click context menu.",
  "Stay in front of your camera at all times.",
  "Only one person should be visible in the webcam feed.",
  "Do not use voice assistants or have someone else speak for you.",
  "Any violation will be logged and may result in review.",
];

export default function Home() {
  const router = useRouter();

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
            Exam Rules
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Before you begin, please read the following carefully.
          </Typography>
          <List dense>
            {rules.map((rule, i) => (
              <ListItem key={i} disableGutters>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <WarningAmberIcon fontSize="small" color="warning" />
                </ListItemIcon>
                <ListItemText primary={rule} slotProps={{ primary: { variant: "body2" } }} />
              </ListItem>
            ))}
          </List>
          <Button
            variant="contained"
            fullWidth
            size="large"
            sx={{ mt: 2 }}
            onClick={() => router.push("/exam")}
          >
            Start Exam
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}
