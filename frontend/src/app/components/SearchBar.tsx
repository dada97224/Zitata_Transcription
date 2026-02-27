"use client";

import { FormEvent } from "react";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: (e: FormEvent) => void;
  loading: boolean;
}

export function SearchBar({ query, onQueryChange, onSearch, loading }: SearchBarProps) {
  return (
    <form onSubmit={onSearch} className="mb-8">
      <div className="flex gap-3 max-w-2xl mx-auto">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder='Rechercher... ex: "ouragan", "économie", "climat"'
          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {loading ? "..." : "Rechercher"}
        </button>
      </div>
    </form>
  );
}
