"use client";

import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import Chip from "@mui/material/Chip";

interface QuestionListProps {
  total: number;
  seenIndices: number[];
  currentIndex: number;
  answers: Record<number, string>;
  onSelect: (index: number) => void;
}

export default function QuestionList({
  total,
  seenIndices,
  currentIndex,
  answers,
  onSelect,
}: QuestionListProps) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1, overflow: "hidden" }}>
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" color="text.secondary">
          Questions
        </Typography>
      </Box>
      <List dense disablePadding>
        {seenIndices.map((idx) => {
          const answered = answers[idx] !== undefined;
          return (
            <ListItemButton
              key={idx}
              selected={idx === currentIndex}
              onClick={() => onSelect(idx)}
              sx={{ gap: 1 }}
            >
              <ListItemText
                primary={`Q${idx + 1}`}
                slotProps={{
                  primary: {
                    variant: "body2",
                    sx: { fontWeight: idx === currentIndex ? 700 : 400 },
                  },
                }}
              />
              {answered && (
                <CheckCircleIcon fontSize="small" color="success" />
              )}
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Chip
          label={`${Object.keys(answers).length} / ${total} answered`}
          size="small"
          variant="outlined"
          sx={{ width: "100%" }}
        />
      </Box>
    </Paper>
  );
}
