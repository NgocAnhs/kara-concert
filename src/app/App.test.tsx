import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: null }));

import { App } from './App';

describe('App', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  it('shows the public practice catalog', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /thuộc từng câu/i })).toBeInTheDocument();
    expect(screen.getByText('Concert Practice')).toBeInTheDocument();
  });

  it('explains when the public catalog is not configured', () => {
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/supabase/i);
  });

  it('explains missing configuration on a practice deep link', () => {
    window.history.replaceState(null, '', '/practice/1');
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(/supabase/i);
    expect(screen.getByRole('link', { name: /về thư viện/i })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('heading', { name: /không tìm thấy/i })).not.toBeInTheDocument();
  });
});
