"use client";

import { useState } from "react";
import { CheckCircle, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { saveApiKey, deleteApiKey } from "@/actions/apiKey.actions";
import { toastSuccess, toastError } from "@/lib/toast";
import type { ApiKeyClientResponse } from "@/models/apiKey.model";

const USAJOBS_REQUEST_URL = "https://developer.usajobs.gov/apirequest/";

interface UsajobsCredentialsCardProps {
  keys: ApiKeyClientResponse[];
  onChanged: () => Promise<void> | void;
}

// USAJOBS needs two values: the API key (secret, stored encrypted like the AI
// keys) and the email address it was registered with (sent as the User-Agent;
// stored as a plain, displayable value like the Ollama base URL). USAJOBS has
// no key-check endpoint JobSync can call, so unlike the AI providers there is
// no "Verify" step: a wrong key shows up as a failed run.
export function UsajobsCredentialsCard({
  keys,
  onChanged,
}: UsajobsCredentialsCardProps) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const savedKey = keys.find((k) => k.provider === "usajobs");
  const savedEmail = keys.find((k) => k.provider === "usajobs_email");

  const startEditing = () => {
    setApiKey("");
    setEmail("");
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setApiKey("");
    setEmail("");
  };

  // A blank field leaves its saved value untouched, so either half can be
  // updated on its own.
  const handleSave = async () => {
    const newKey = apiKey.trim();
    const newEmail = email.trim();
    if (!newKey && !newEmail) return;

    setSaving(true);
    let savedAny = false;
    try {
      if (newKey) {
        const res = await saveApiKey({ provider: "usajobs", key: newKey });
        if (!res.success) {
          toastError(res.message || "Failed to save API key", "Save failed");
          return;
        }
        savedAny = true;
      }
      if (newEmail) {
        const res = await saveApiKey({
          provider: "usajobs_email",
          key: newEmail,
          sensitive: false,
        });
        if (!res.success) {
          toastError(
            res.message || "Failed to save registration email",
            "Save failed",
          );
          return;
        }
        savedAny = true;
      }
      toastSuccess("USAJOBS credentials saved.", "API key saved");
      cancel();
    } catch (error) {
      console.error("Error saving USAJOBS credentials:", error);
      toastError("An unexpected error occurred");
    } finally {
      // Refresh even after a partial save so the badges match what is stored.
      if (savedAny) await onChanged();
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const results = await Promise.all([
        deleteApiKey("usajobs"),
        deleteApiKey("usajobs_email"),
      ]);
      const failed = results.find((r) => !r.success);
      if (failed) {
        toastError(failed.message || "Failed to delete USAJOBS credentials");
      } else {
        toastSuccess("USAJOBS credentials removed.", "API key deleted");
      }
      await onChanged();
    } catch (error) {
      console.error("Error deleting USAJOBS credentials:", error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div>
          <CardTitle className="text-base">USAJOBS</CardTitle>
          <CardDescription className="text-sm">
            Search US federal job announcements from automations. Needs an API
            key and the email address you registered it with. These are saved
            as entered and not checked here; a wrong value shows up as a failed
            automation run.{" "}
            <a
              href={USAJOBS_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline hover:text-foreground"
            >
              Request a key
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">API key</span>
            {savedKey ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100 dark:hover:bg-green-900">
                <CheckCircle className="h-3 w-3 mr-1" />
                {`····${savedKey.last4}`}
              </Badge>
            ) : (
              <Badge variant="secondary">Not configured</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Registration email</span>
            {savedEmail ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100 dark:hover:bg-green-900">
                <CheckCircle className="h-3 w-3 mr-1" />
                {savedEmail.displayValue || savedEmail.last4}
              </Badge>
            ) : (
              <Badge variant="secondary">Not configured</Badge>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="key-usajobs">API Key</Label>
              <Input
                id="key-usajobs"
                type="password"
                autoComplete="off"
                placeholder={savedKey ? "Leave blank to keep the saved key" : "USAJOBS API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="key-usajobs_email">Registration email</Label>
              <Input
                id="key-usajobs_email"
                type="email"
                autoComplete="off"
                placeholder={savedEmail ? "Leave blank to keep the saved email" : "you@example.com"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={(!apiKey.trim() && !email.trim()) || saving}
              >
                {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={startEditing}>
              <Plus className="h-3 w-3 mr-1" />
              {savedKey || savedEmail ? "Update credentials" : "Add credentials"}
            </Button>
            {(savedKey || savedEmail) && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={deleting}
                    aria-label="Delete USAJOBS credentials"
                  >
                    {deleting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete USAJOBS credentials
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete your USAJOBS API key and
                      registration email? The system will fall back to the
                      server environment variables if available.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
