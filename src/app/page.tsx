import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export default function Home() {
  return (
    <Stack spacing={3}>
      <Typography variant="h4">UnivAI Exams</Typography>
      <Typography variant="body1" color="text.secondary">
        This service holds the quizzes and exams for a UnivAI course. Students do not
        browse it directly: the UnivAI app opens an exam here when its window is open.
      </Typography>
      <Alert severity="info">
        Arrived here by accident? Go back to the UnivAI app and open your exam from the
        Exams page — it knows which one is due.
      </Alert>
    </Stack>
  );
}
