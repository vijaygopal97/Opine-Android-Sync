export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  userType: 'interviewer' | 'admin' | 'user' | 'super_admin' | 'quality_agent';
  company?: any;
  companyCode?: string;
  status: 'active' | 'inactive' | 'suspended';
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface Survey {
  _id: string;
  surveyName: string;
  description: string;
  mode: 'capi' | 'cati' | 'online' | 'multi_mode';
  modes?: string[];
  modeAllocation?: {
    capi?: number;
    cati?: number;
  };
  modeQuotas?: {
    capi?: number | null;
    cati?: number | null;
  };
  modeGigWorkers?: {
    capi?: boolean;
    cati?: boolean;
  };
  includeGigWorkers?: boolean;
  assignedMode?: 'capi' | 'cati' | 'single';
  status: 'draft' | 'active' | 'completed' | 'archived';
  questions: Question[];
  sections?: Section[];
  targetAudience: {
    demographics?: any;
    geographic?: any;
    behavioral?: any;
    psychographic?: any;
    custom?: string;
    quotaManagement?: boolean;
  };
  estimatedDuration?: number;
  sampleSize?: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  category?: string;
  assignmentStatus?: string;
  assignedAt?: string;
  assignedACs?: string[];
  selectedState?: string;
  selectedCountry?: string;
  maxInterviews?: number;
  completedInterviews?: number;
  deadline?: string;
  startDate?: string;
  purpose?: string;
  costPerInterview?: number;
}

export interface Section {
  _id?: string;
  id?: string;
  title: string;
  description?: string;
  questions: Question[];
  order: number;
}

export interface Question {
  _id?: string;
  id?: string;
  type: 'text' | 'multiple_choice' | 'single_choice' | 'rating' | 'date' | 'number' | 'numeric';
  text: string;
  options?: string[] | Array<{ id?: string; text: string; value?: string; code?: string }>;
  required: boolean;
  order: number;
  description?: string;
  conditions?: any[];
  scale?: {
    min?: number;
    max?: number;
    step?: number;
    labels?: string[];
    minLabel?: string;
    maxLabel?: string;
  };
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  settings?: {
    allowMultiple?: boolean;
    maxSelections?: number;
    allowOther?: boolean;
  };
}

export interface SurveyResponse {
  _id: string;
  surveyId: string;
  survey: Survey;
  interviewerId: string;
  interviewer: User;
  responses: ResponseData[];
  status: 'in_progress' | 'completed' | 'submitted' | 'Pending_Approval' | 'Approved' | 'Rejected' | 'abandoned';
  startTime?: string | Date; // Backend returns startTime
  startedAt?: string | Date; // Legacy field for compatibility
  endTime?: string | Date; // Backend returns endTime
  completedAt?: string | Date; // Legacy field for compatibility
  submittedAt?: string;
  totalTimeSpent?: number; // Backend returns totalTimeSpent (in seconds)
  totalDuration?: number; // Legacy field for compatibility
  locationData?: LocationData;
  location?: LocationData;
  audioUrl?: string;
  audioRecording?: {
    url?: string;
    audioUrl?: string;
    fileSize?: number;
    format?: string;
    duration?: number;
  };
  createdAt: string;
  updatedAt: string;
  responseId?: string;
  sessionId?: string;
  interviewMode?: 'capi' | 'cati' | 'online';
}

export interface ResponseData {
  questionId: string;
  question: Question;
  answer: string | string[] | number;
  timestamp: string;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  address: string;
  city: string;
  state: string;
  country: string;
  timestamp: string;
  source: 'gps' | 'wifi_triangulation' | 'network' | 'google_maps' | 'manual';
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: User;
  message?: string;
}

export interface NavigationProps {
  navigation: any;
  route: any;
}

export interface DashboardProps extends NavigationProps {
  user: User;
  onLogout: () => void;
}
