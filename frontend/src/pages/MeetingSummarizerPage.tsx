import React, { useState, useEffect, useId } from "react";
import { useWorkspaceStore } from "../store/workspace.store";
import { summarizeMeeting } from "../api/ai.api";
import { getWorkspaceBoards, bulkCreateTasks } from "../api/task.api";
import type { Board, MeetingSummary, Task } from "../types/task.types";
import { Button } from "../components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/card";
import {
  Sparkles,
  Calendar,
  Users,
  CheckCircle2,
  HelpCircle,
  Clock,
  Loader2,
  AlertCircle,
  Check,
  ListTodo,
  FileText,
  Building2,
  Plus,
} from "lucide-react";

export const MeetingSummarizerPage: React.FC = () => {
  const meetingNotesId = useId();
  const targetBoardId = useId();
  const { currentWorkspace } = useWorkspaceStore();

  // State
  const [meetingNotes, setMeetingNotes] = useState<string>("");
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [summaryData, setSummaryData] = useState<MeetingSummary | null>(null);
  const [selectedActionIndices, setSelectedActionIndices] = useState<number[]>([]);
  const [createdTasksResult, setCreatedTasksResult] = useState<Task[] | null>(null);

  // Independent Loading States
  const [boardsLoading, setBoardsLoading] = useState<boolean>(false);
  const [summarizing, setSummarizing] = useState<boolean>(false);
  const [creatingTasks, setCreatingTasks] = useState<boolean>(false);

  // Independent Error States
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [taskCreationError, setTaskCreationError] = useState<string | null>(null);

  // 1. Fetch Real Boards when Active Workspace changes
  useEffect(() => {
    // Reset state on workspace switch
    setSummaryData(null);
    setSelectedActionIndices([]);
    setCreatedTasksResult(null);
    setSummaryError(null);
    setTaskCreationError(null);

    if (!currentWorkspace?._id) {
      setBoards([]);
      setSelectedBoardId("");
      return;
    }

    const fetchBoards = async () => {
      setBoardsLoading(true);
      setBoardsError(null);
      try {
        const workspaceBoards = await getWorkspaceBoards(currentWorkspace._id);
        setBoards(workspaceBoards);
        if (workspaceBoards.length > 0) {
          setSelectedBoardId(workspaceBoards[0]._id);
        } else {
          setSelectedBoardId("");
        }
      } catch (err: any) {
        const message =
          err.response?.data?.message ||
          err.message ||
          "Failed to load workspace boards";
        setBoardsError(message);
        setBoards([]);
      } finally {
        setBoardsLoading(false);
      }
    };

    fetchBoards();
  }, [currentWorkspace?._id]);

  // 2. Summarize Meeting Handler
  const handleSummarize = async () => {
    const trimmed = meetingNotes.trim();
    if (!currentWorkspace?._id || !trimmed || trimmed.length < 10) return;

    setSummarizing(true);
    setSummaryError(null);
    setSummaryData(null);
    setCreatedTasksResult(null);
    setTaskCreationError(null);

    try {
      const summary = await summarizeMeeting({
        workspaceId: currentWorkspace._id,
        text: trimmed,
      });

      setSummaryData(summary);
      // Default: select all action items
      if (summary.action_items && summary.action_items.length > 0) {
        setSelectedActionIndices(summary.action_items.map((_, idx) => idx));
      } else {
        setSelectedActionIndices([]);
      }
    } catch (err: any) {
      let errorMessage = "Failed to generate meeting summary. Please try again.";
      if (err.response?.status === 400) {
        errorMessage = err.response.data?.message || "Please provide valid meeting notes (at least 10 characters).";
      } else if (err.response?.status === 401) {
        errorMessage = "Your session has expired. Please sign in again.";
      } else if (err.response?.status === 403) {
        errorMessage = "You do not have access to this workspace.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      setSummaryError(errorMessage);
    } finally {
      setSummarizing(false);
    }
  };

  // Toggle Action Item Checkbox
  const toggleActionItem = (index: number) => {
    setSelectedActionIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const toggleAllActionItems = () => {
    if (!summaryData?.action_items) return;
    if (selectedActionIndices.length === summaryData.action_items.length) {
      setSelectedActionIndices([]);
    } else {
      setSelectedActionIndices(summaryData.action_items.map((_, idx) => idx));
    }
  };

  // 3. Create Tasks Handler
  const handleCreateTasks = async () => {
    if (
      !currentWorkspace?._id ||
      !selectedBoardId ||
      !summaryData?.action_items ||
      selectedActionIndices.length === 0
    ) {
      return;
    }

    setCreatingTasks(true);
    setTaskCreationError(null);
    setCreatedTasksResult(null);

    try {
      const itemsToCreate = selectedActionIndices.map(
        (idx) => summaryData.action_items[idx]
      );

      const bulkPayload = {
        tasks: itemsToCreate.map((item) => {
          let parsedDueDate: string | null = null;
          if (item.due && item.due.trim() !== "") {
            const d = new Date(item.due);
            if (!isNaN(d.getTime())) {
              parsedDueDate = d.toISOString();
            }
          }

          return {
            boardId: selectedBoardId,
            title: item.task,
            description: item.assignee ? `Assignee context: ${item.assignee}` : undefined,
            status: "todo" as const,
            priority: "medium" as const,
            assigneeId: null, // Mandatory: name string is preserved in text context, no fake ID invented
            dueDate: parsedDueDate,
            parentTaskId: null,
          };
        }),
      };

      const createdTasks = await bulkCreateTasks(
        currentWorkspace._id,
        bulkPayload
      );

      setCreatedTasksResult(createdTasks);
    } catch (err: any) {
      let errorMessage = "Failed to create tasks. Please verify selected board.";
      if (err.response?.status === 400) {
        errorMessage = err.response.data?.message || "Invalid task payload or board reference.";
      } else if (err.response?.status === 401) {
        errorMessage = "Your session has expired. Please sign in again.";
      } else if (err.response?.status === 403) {
        errorMessage = "You do not have access to this workspace.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      setTaskCreationError(errorMessage);
    } finally {
      setCreatingTasks(false);
    }
  };

  // Empty Workspace State
  if (!currentWorkspace) {
    return (
      <div className="p-6 md:p-8 max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-14 h-14 rounded-2xl bg-bg-surface border border-border-default flex items-center justify-center text-text-secondary mb-4 shadow-lg">
          <Building2 className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-text-primary">No Workspace Selected</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-md">
          Please select or create a workspace from the workspace switcher to access the Meeting Summarizer.
        </p>
      </div>
    );
  }

  const isInputValid = meetingNotes.trim().length >= 10;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 bg-bg-base text-text-primary">
      {/* Page Header */}
      <div className="flex flex-col gap-1 border-b border-border-default pb-5">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-[#7C6AF7]/10 text-[#7C6AF7] border border-[#7C6AF7]/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            Meeting Summarizer
          </h1>
        </div>
        <p className="text-sm text-text-secondary mt-1">
          Transform raw meeting notes into structured summaries, key decisions, and executable Kanban tasks using Grok AI.
        </p>
      </div>

      {/* Input Section */}
      <Card className="bg-bg-surface border-border-default shadow-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-text-primary">
            <FileText className="w-4 h-4 text-[#7C6AF7]" />
            Raw Meeting Notes
          </CardTitle>
          <CardDescription className="text-xs text-text-secondary">
            Paste raw transcripts, bullet points, or discussion summaries below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={meetingNotesId} className="sr-only">
              Meeting Notes Text
            </label>
            <textarea
              id={meetingNotesId}
              rows={7}
              className="w-full p-3.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary placeholder:text-text-secondary/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50 focus:border-[#7C6AF7] transition-all resize-y"
              placeholder="Paste your meeting notes here (e.g. August 20 meeting notes with attendees, decisions, and action items)..."
              value={meetingNotes}
              onChange={(e) => setMeetingNotes(e.target.value)}
              disabled={summarizing}
            />
          </div>

          {summaryError && (
            <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-2.5 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{summaryError}</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex items-center justify-between border-t border-border-default pt-4 bg-bg-elevated/40 rounded-b-xl">
          <span className="text-xs text-text-secondary">
            {meetingNotes.trim().length === 0
              ? "0 characters entered"
              : `${meetingNotes.trim().length} characters`}
          </span>

          <Button
            onClick={handleSummarize}
            disabled={!isInputValid || summarizing}
            className="bg-[#7C6AF7] hover:bg-[#6b58f6] text-white gap-2 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {summarizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Summarizing...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Summarize Meeting</span>
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Structured Summary Output Display */}
      {summaryData && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Structured Meeting Insights
            </h2>
            <span className="text-xs text-text-secondary bg-bg-elevated px-2.5 py-1 rounded-full border border-border-default">
              Generated by Grok AI
            </span>
          </div>

          {/* Grid Layout for Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Executive Summary */}
            {summaryData.summary && (
              <Card className="bg-bg-surface border-border-default md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-text-primary">
                    <Sparkles className="w-4 h-4 text-[#7C6AF7]" />
                    Executive Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                    {summaryData.summary}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Date & Attendees Row */}
            {(summaryData.meeting_date || (summaryData.attendees && summaryData.attendees.length > 0)) && (
              <Card className="bg-bg-surface border-border-default">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-text-primary">
                    <Calendar className="w-4 h-4 text-blue-400" />
                    Meeting Meta
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {summaryData.meeting_date && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-text-secondary">Date:</span>
                      <span className="font-medium text-text-primary px-2 py-0.5 rounded bg-bg-elevated border border-border-default">
                        {summaryData.meeting_date}
                      </span>
                    </div>
                  )}

                  {summaryData.attendees && summaryData.attendees.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs text-text-secondary flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-blue-400" />
                        Attendees:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {summaryData.attendees.map((attendee, idx) => (
                          <span
                            key={idx}
                            className="text-xs px-2.5 py-1 rounded-md bg-bg-elevated border border-border-default text-text-primary font-medium"
                          >
                            {attendee}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Next Meeting */}
            {summaryData.next_meeting && (
              <Card className="bg-bg-surface border-border-default">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-text-primary">
                    <Clock className="w-4 h-4 text-amber-400" />
                    Next Meeting
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xs font-medium text-text-primary px-3 py-1 rounded-md bg-bg-elevated border border-border-default inline-block">
                    {summaryData.next_meeting}
                  </span>
                </CardContent>
              </Card>
            )}

            {/* Decisions Made */}
            {summaryData.decisions && summaryData.decisions.length > 0 && (
              <Card className="bg-bg-surface border-border-default md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-text-primary">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Key Decisions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {summaryData.decisions.map((decision, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-text-secondary flex items-start gap-2 bg-bg-elevated/50 p-2.5 rounded-lg border border-border-default"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                        <span className="leading-relaxed text-text-primary">{decision}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Open Questions */}
            {summaryData.open_questions && summaryData.open_questions.length > 0 && (
              <Card className="bg-bg-surface border-border-default md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-text-primary">
                    <HelpCircle className="w-4 h-4 text-purple-400" />
                    Open Questions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {summaryData.open_questions.map((question, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-text-secondary flex items-start gap-2 bg-bg-elevated/50 p-2.5 rounded-lg border border-border-default"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0 mt-1.5" />
                        <span className="leading-relaxed text-text-primary">{question}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Action Items & Kanban Task Creation Card */}
          <Card className="bg-bg-surface border-border-default shadow-xl">
            <CardHeader className="pb-3 border-b border-border-default">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2 text-text-primary">
                    <ListTodo className="w-5 h-5 text-[#7C6AF7]" />
                    Action Items → Kanban Tasks
                  </CardTitle>
                  <CardDescription className="text-xs text-text-secondary mt-1">
                    Select identified action items and assign them to a target workspace Kanban board.
                  </CardDescription>
                </div>

                {summaryData.action_items && summaryData.action_items.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleAllActionItems}
                    className="text-xs h-8 border-border-default hover:bg-bg-elevated cursor-pointer"
                  >
                    {selectedActionIndices.length === summaryData.action_items.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-5">
              {/* Action Items Checkable List */}
              {summaryData.action_items && summaryData.action_items.length > 0 ? (
                <div className="space-y-2.5">
                  {summaryData.action_items.map((item, idx) => {
                    const isSelected = selectedActionIndices.includes(idx);
                    return (
                      <div
                        key={idx}
                        onClick={() => toggleActionItem(idx)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                          isSelected
                            ? "bg-[#7C6AF7]/10 border-[#7C6AF7]/40 text-text-primary"
                            : "bg-bg-elevated/40 border-border-default text-text-secondary hover:border-border-subtle"
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                            isSelected
                              ? "bg-[#7C6AF7] border-[#7C6AF7] text-white"
                              : "border-border-default bg-bg-surface"
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>

                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-xs font-medium leading-relaxed text-text-primary">
                            {item.task}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            {item.assignee && (
                              <span className="px-2 py-0.5 rounded bg-bg-surface border border-border-default text-text-secondary flex items-center gap-1">
                                <Users className="w-3 h-3 text-[#7C6AF7]" />
                                {item.assignee}
                              </span>
                            )}
                            {item.due && (
                              <span className="px-2 py-0.5 rounded bg-bg-surface border border-border-default text-text-secondary flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-amber-400" />
                                {item.due}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-text-secondary bg-bg-elevated/30 rounded-xl border border-border-default">
                  No action items were identified in these meeting notes.
                </div>
              )}

              {/* Target Board Selector & Creation Control */}
              {summaryData.action_items && summaryData.action_items.length > 0 && (
                <div className="p-4 rounded-xl bg-bg-elevated border border-border-default space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <label htmlFor={targetBoardId} className="text-xs font-semibold text-text-primary block">
                        Target Kanban Board
                      </label>
                      <span className="text-[11px] text-text-secondary block">
                        Select which board will store the created tasks.
                      </span>
                    </div>

                    {boardsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-text-secondary">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7C6AF7]" />
                        <span>Loading boards...</span>
                      </div>
                    ) : boards.length > 0 ? (
                      <select
                        id={targetBoardId}
                        value={selectedBoardId}
                        onChange={(e) => setSelectedBoardId(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-bg-surface border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50 min-w-[200px]"
                      >
                        {boards.map((b) => (
                          <option key={b._id} value={b._id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-amber-400 font-medium">
                        No boards available in this workspace
                      </span>
                    )}
                  </div>

                  {boardsError && (
                    <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{boardsError}</span>
                    </div>
                  )}

                  {boards.length === 0 && !boardsLoading && (
                    <p className="text-xs text-text-secondary bg-bg-surface p-3 rounded-lg border border-border-default">
                      A Kanban board is required before action items can be created as tasks. Please create a board in the Tasks module first.
                    </p>
                  )}

                  {taskCreationError && (
                    <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{taskCreationError}</span>
                    </div>
                  )}

                  {/* Task Creation Success Notification */}
                  {createdTasksResult && (
                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 space-y-2">
                      <div className="flex items-center gap-2 font-semibold text-sm">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                        <span>{createdTasksResult.length} tasks created successfully!</span>
                      </div>
                      <ul className="pl-6 list-disc space-y-1 text-emerald-300/80">
                        {createdTasksResult.map((task) => (
                          <li key={task._id}>{task.title}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <Button
                      onClick={handleCreateTasks}
                      disabled={
                        creatingTasks ||
                        boards.length === 0 ||
                        !selectedBoardId ||
                        selectedActionIndices.length === 0
                      }
                      className="bg-[#7C6AF7] hover:bg-[#6b58f6] text-white gap-2 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs h-9 px-4"
                    >
                      {creatingTasks ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Creating Tasks...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>
                            Create {selectedActionIndices.length} Selected{" "}
                            {selectedActionIndices.length === 1 ? "Task" : "Tasks"}
                          </span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
