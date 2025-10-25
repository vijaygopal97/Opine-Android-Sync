export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  userType: 'interviewer' | 'admin' | 'user' | 'super_admin';
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
}

export interface Section {
  _id: string;
  title: string;
  description?: string;
  questions: Question[];
  order: number;
}

export interface Question {
  _id: string;
  type: 'text' | 'multiple_choice' | 'single_choice' | 'rating' | 'date' | 'number';
  text: string;
  options?: string[];
  required: boolean;
  order: number;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface SurveyResponse {
  _id: string;
  surveyId: string;
  survey: Survey;
  interviewerId: string;
  interviewer: User;
  responses: ResponseData[];
  status: 'in_progress' | 'completed' | 'submitted';
  startedAt: string;
  completedAt?: string;
  submittedAt?: string;
  locationData?: LocationData;
  audioUrl?: string;
  totalDuration?: number;
  createdAt: string;
  updatedAt: string;
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
