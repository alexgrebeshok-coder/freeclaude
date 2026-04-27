import React from 'react';

interface IconProps {
  name:
    | 'plus'
    | 'search'
    | 'plug'
    | 'bolt'
    | 'folder'
    | 'chat'
    | 'terminal'
    | 'settings'
    | 'sparkles'
    | 'chevron-down'
    | 'chevron-right'
    | 'arrow-up'
    | 'stop'
    | 'sliders'
    | 'clock'
    | 'file';
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps): React.ReactElement {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    'aria-hidden': true
  };

  switch (name) {
    case 'plus':
      return (
        <svg {...commonProps}>
          <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'search':
      return (
        <svg {...commonProps}>
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...commonProps}>
          <path d="M9 7V3M15 7V3M8 7H16V11C16 13.2 14.2 15 12 15C9.8 15 8 13.2 8 11V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 15V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...commonProps}>
          <path d="M13 2L5 13H11L10 22L19 10H13L13 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...commonProps}>
          <path d="M3 7.5C3 6.67 3.67 6 4.5 6H9L11 8H19.5C20.33 8 21 8.67 21 9.5V17.5C21 18.33 20.33 19 19.5 19H4.5C3.67 19 3 18.33 3 17.5V7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...commonProps}>
          <path d="M5 18L6.6 14.8C5.62 13.83 5 12.5 5 11C5 7.69 8.13 5 12 5C15.87 5 19 7.69 19 11C19 14.31 15.87 17 12 17H5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...commonProps}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7 10L10 12L7 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 15H16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...commonProps}>
          <path d="M12 8.5C10.07 8.5 8.5 10.07 8.5 12C8.5 13.93 10.07 15.5 12 15.5C13.93 15.5 15.5 13.93 15.5 12C15.5 10.07 13.93 8.5 12 8.5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M19.4 15A1 1 0 0 0 19.6 16.1L19.65 16.15A2 2 0 1 1 16.82 18.98L16.77 18.93A1 1 0 0 0 15.67 18.73A1 1 0 0 0 15 19.66V19.8A2 2 0 1 1 11 19.8V19.73A1 1 0 0 0 10.35 18.81A1 1 0 0 0 9.23 19L9.18 19.05A2 2 0 1 1 6.35 16.22L6.4 16.17A1 1 0 0 0 6.6 15.07A1 1 0 0 0 5.67 14.4H5.5A2 2 0 1 1 5.5 10.4H5.57A1 1 0 0 0 6.49 9.75A1 1 0 0 0 6.29 8.65L6.24 8.6A2 2 0 1 1 9.07 5.77L9.12 5.82A1 1 0 0 0 10.22 6.02H10.35A1 1 0 0 0 11 5.1V5A2 2 0 1 1 15 5V5.07A1 1 0 0 0 15.65 5.99A1 1 0 0 0 16.75 5.79L16.8 5.74A2 2 0 1 1 19.63 8.57L19.58 8.62A1 1 0 0 0 19.38 9.72V9.85A1 1 0 0 0 20.3 10.5H20.5A2 2 0 1 1 20.5 14.5H20.43A1 1 0 0 0 19.5 15.15L19.4 15Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...commonProps}>
          <path d="M12 3L13.6 7.4L18 9L13.6 10.6L12 15L10.4 10.6L6 9L10.4 7.4L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M18.5 3.5L19 5L20.5 5.5L19 6L18.5 7.5L18 6L16.5 5.5L18 5L18.5 3.5Z" fill="currentColor" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg {...commonProps}>
          <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...commonProps}>
          <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'arrow-up':
      return (
        <svg {...commonProps}>
          <path d="M12 18V6M12 6L7 11M12 6L17 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...commonProps}>
          <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
        </svg>
      );
    case 'sliders':
      return (
        <svg {...commonProps}>
          <path d="M4 7H10M14 7H20M7 7V17M4 17H12M16 17H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="7" r="2" fill="currentColor" />
          <circle cx="14" cy="17" r="2" fill="currentColor" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 8V12L15 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'file':
      return (
        <svg {...commonProps}>
          <path d="M8 3H14L19 8V19C19 20.1 18.1 21 17 21H8C6.9 21 6 20.1 6 19V5C6 3.9 6.9 3 8 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M14 3V8H19" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
  }
}
