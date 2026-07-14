"use client";

import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";

interface EndExamDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EndExamDialog({ open, onConfirm, onCancel }: EndExamDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>End Exam?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to end the exam? Your progress will be submitted and you cannot
          go back.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          End Exam
        </Button>
      </DialogActions>
    </Dialog>
  );
}
