import { http, HttpResponse } from 'msw';
import {
  mockConversations,
  mockConversationDetail,
  mockSearchResults,
  mockConfig,
} from './data';

export const handlers = [
  // GET /api/conversations - list conversations
  http.get('/api/conversations', ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    const starred = url.searchParams.get('starred');
    const model = url.searchParams.get('model');

    let result = [...mockConversations];

    // Apply filters
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(searchLower) ||
          c.summary.toLowerCase().includes(searchLower)
      );
    }

    if (starred === 'true') {
      result = result.filter((c) => c.is_starred);
    }

    if (model) {
      result = result.filter((c) => c.model === model);
    }

    return HttpResponse.json(result);
  }),

  // GET /api/conversations/:uuid - get conversation detail
  http.get('/api/conversations/:uuid', ({ params }) => {
    const { uuid } = params;

    if (uuid === 'conv-1') {
      return HttpResponse.json(mockConversationDetail);
    }

    if (uuid === 'not-found') {
      return new HttpResponse(null, { status: 404 });
    }

    // Return a minimal detail for other UUIDs
    const conversation = mockConversations.find((c) => c.uuid === uuid);
    if (conversation) {
      return HttpResponse.json({
        ...conversation,
        messages: [],
        current_leaf_message_uuid: '',
      });
    }

    return new HttpResponse(null, { status: 404 });
  }),

  // GET /api/conversations/:uuid/tree - get conversation tree
  http.get('/api/conversations/:uuid/tree', ({ params }) => {
    const { uuid } = params;

    return HttpResponse.json({
      uuid,
      root_messages: [],
      active_path: [],
    });
  }),

  // GET /api/search - search conversations
  http.get('/api/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');

    if (!query || query.length < 2) {
      return HttpResponse.json([]);
    }

    // Filter mock results by query
    const results = mockSearchResults.filter(
      (r) =>
        r.conversation_name.toLowerCase().includes(query.toLowerCase()) ||
        r.matching_messages.some((m) =>
          m.snippet.toLowerCase().includes(query.toLowerCase())
        )
    );

    return HttpResponse.json(results);
  }),

  // GET /api/config - get app config
  http.get('/api/config', () => {
    return HttpResponse.json(mockConfig);
  }),

  // GET /api/conversations/:uuid/export/markdown - export as markdown
  http.get('/api/conversations/:uuid/export/markdown', () => {
    const markdown = '# Building a React App\n\n**Human:** How do I create a React component?\n\n**Claude:** Here\'s how...';
    return new HttpResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': 'attachment; filename="conversation.md"',
      },
    });
  }),

  // GET /api/conversations/:uuid/export/pdf - export as PDF
  http.get('/api/conversations/:uuid/export/pdf', () => {
    // Return a minimal PDF-like response
    return new HttpResponse(new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="conversation.pdf"',
      },
    });
  }),
];
