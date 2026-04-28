import { TFunction } from 'i18next';

/**
 * Format a timestamp using the host timezone reported by the backend.
 */
export const formatTimestamp = (
  dateInput: string | number | Date,
  options: { timeZone?: string | null; includeTime?: boolean } = {},
) => {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    return '';
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(options.includeTime ? {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    } : {}),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });

  return formatter.format(date).replace(',', '');
};

export const formatTimeAgo = (
  dateString: string,
  currentTime: Date,
  t: TFunction,
  hostTimeZone?: string | null,
) => {
  const date = new Date(dateString);
  const now = currentTime;

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return t ? t('status.unknown') : 'Unknown';
  }

  const diffInMs = now.getTime() - date.getTime();
  const diffInSeconds = Math.floor(diffInMs / 1000);
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInSeconds < 60) return t ? t('time.justNow') : 'Just now';
  if (diffInMinutes === 1) return t ? t('time.oneMinuteAgo') : '1 min ago';
  if (diffInMinutes < 60) return t ? t('time.minutesAgo', { count: diffInMinutes }) : `${diffInMinutes} mins ago`;
  if (diffInHours === 1) return t ? t('time.oneHourAgo') : '1 hour ago';
  if (diffInHours < 24) return t ? t('time.hoursAgo', { count: diffInHours }) : `${diffInHours} hours ago`;
  if (diffInDays === 1) return t ? t('time.oneDayAgo') : '1 day ago';
  if (diffInDays < 7) return t ? t('time.daysAgo', { count: diffInDays }) : `${diffInDays} days ago`;
  return formatTimestamp(date, { timeZone: hostTimeZone, includeTime: false });
};
