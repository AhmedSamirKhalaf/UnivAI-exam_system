"use client";

import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";

interface Option {
  label: string;
  value: string;
}

interface QuestionCardProps {
  questionNumber: number;
  text: string;
  options: Option[];
  selectedAnswer: string | null;
  onAnswer: (value: string) => void;
}

export default function QuestionCard({
  questionNumber,
  text,
  options,
  selectedAnswer,
  onAnswer,
}: QuestionCardProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" color="primary" gutterBottom>
          Question {questionNumber}
        </Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {text}
        </Typography>
        <FormControl component="fieldset" fullWidth>
          <RadioGroup
            value={selectedAnswer ?? ""}
            onChange={(_, value) => onAnswer(value)}
          >
            {options.map((opt) => (
              <FormControlLabel
                key={opt.value}
                value={opt.value}
                control={<Radio />}
                label={opt.label}
              />
            ))}
          </RadioGroup>
        </FormControl>
      </CardContent>
    </Card>
  );
}
