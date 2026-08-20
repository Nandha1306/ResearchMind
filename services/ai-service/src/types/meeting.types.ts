export interface SummarizeMeetingRequest {
  workspaceId: string;
  text: string;
}

export interface MeetingActionItem {
  task: string;
  assignee: string;
  due: string;
}

export interface MeetingSummary {
  meeting_date: string;
  attendees: string[];
  summary: string;
  decisions: string[];
  action_items: MeetingActionItem[];
  open_questions: string[];
  next_meeting: string;
}