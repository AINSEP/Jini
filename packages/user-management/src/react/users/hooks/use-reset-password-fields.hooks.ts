import { useEffect, useState } from "react";

import type { AdminIdentityUser } from "../../models.js";

export interface ResetPasswordFieldsInput {

  resetPasswordFor: AdminIdentityUser | null;

  newPassword: string;
}

export interface ResetPasswordFieldsController {

  confirmPassword: string;
  setConfirmPassword: (value: string) => void;

  mismatch: boolean;
  showNewPassword: boolean;
  toggleShowNewPassword: () => void;
  showConfirmPassword: boolean;
  toggleShowConfirmPassword: () => void;
}

export function useResetPasswordFields({ resetPasswordFor, newPassword }: ResetPasswordFieldsInput): ResetPasswordFieldsController {
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    setConfirmPassword("");
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  }, [resetPasswordFor?.principalId]);

  return {
    confirmPassword,
    setConfirmPassword,
    mismatch: newPassword !== confirmPassword,
    showNewPassword,
    toggleShowNewPassword: () => setShowNewPassword((visible) => !visible),
    showConfirmPassword,
    toggleShowConfirmPassword: () => setShowConfirmPassword((visible) => !visible),
  };
}
