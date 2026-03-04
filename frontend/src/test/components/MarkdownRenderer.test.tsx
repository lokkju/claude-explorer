import { describe, it, expect } from 'vitest';
import { render, screen } from '../utils';
import { MarkdownRenderer } from '../../components/message/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    render(<MarkdownRenderer content="Hello, world!" />);
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders headers', () => {
    render(<MarkdownRenderer content={`# Heading 1

## Heading 2

### Heading 3`} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Heading 1');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Heading 2');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Heading 3');
  });

  it('renders bold and italic text', () => {
    render(<MarkdownRenderer content="This is **bold** and *italic* text." />);

    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();

    // Check that bold is wrapped in strong tag
    const boldElement = screen.getByText('bold');
    expect(boldElement.tagName.toLowerCase()).toBe('strong');

    // Check that italic is wrapped in em tag
    const italicElement = screen.getByText('italic');
    expect(italicElement.tagName.toLowerCase()).toBe('em');
  });

  it('renders code blocks with syntax highlighting', () => {
    const code = '```javascript\nconst x = 1;\nconsole.log(x);\n```';
    render(<MarkdownRenderer content={code} />);

    // Should have a pre element
    const preElement = document.querySelector('pre');
    expect(preElement).toBeInTheDocument();
    expect(preElement).toHaveClass('rounded-lg');

    // Should contain the code
    expect(screen.getByText(/const/)).toBeInTheDocument();
  });

  it('renders inline code with proper styling', () => {
    render(<MarkdownRenderer content="Use the `useState` hook." />);

    const codeElement = screen.getByText('useState');
    expect(codeElement.tagName.toLowerCase()).toBe('code');
    expect(codeElement).toHaveClass('rounded');
  });

  it('renders links', () => {
    render(<MarkdownRenderer content="Check out [Google](https://google.com)." />);

    const link = screen.getByRole('link', { name: 'Google' });
    expect(link).toHaveAttribute('href', 'https://google.com');
  });

  it('opens external links in new tab', () => {
    render(<MarkdownRenderer content="Visit [example](https://example.com)." />);

    const link = screen.getByRole('link', { name: 'example' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders unordered lists', () => {
    render(<MarkdownRenderer content={`- Item 1
- Item 2
- Item 3`} />);

    const list = screen.getByRole('list');
    expect(list.tagName.toLowerCase()).toBe('ul');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Item 1');
  });

  it('renders ordered lists', () => {
    render(<MarkdownRenderer content={`1. First
2. Second
3. Third`} />);

    const list = screen.getByRole('list');
    expect(list.tagName.toLowerCase()).toBe('ol');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('renders tables (GFM)', () => {
    const table = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |
`;
    render(<MarkdownRenderer content={table} />);

    const tableElement = screen.getByRole('table');
    expect(tableElement).toBeInTheDocument();

    // Check headers
    expect(screen.getByText('Header 1')).toBeInTheDocument();
    expect(screen.getByText('Header 2')).toBeInTheDocument();

    // Check cells
    expect(screen.getByText('Cell 1')).toBeInTheDocument();
    expect(screen.getByText('Cell 4')).toBeInTheDocument();
  });

  it('renders blockquotes', () => {
    render(<MarkdownRenderer content="> This is a quote" />);

    const blockquote = document.querySelector('blockquote');
    expect(blockquote).toBeInTheDocument();
    expect(blockquote).toHaveTextContent('This is a quote');
  });

  it('renders horizontal rules', () => {
    render(<MarkdownRenderer content={`Above

---

Below`} />);

    const hr = document.querySelector('hr');
    expect(hr).toBeInTheDocument();
  });

  it('renders images', () => {
    render(<MarkdownRenderer content="![Alt text](https://example.com/image.png)" />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/image.png');
    expect(img).toHaveAttribute('alt', 'Alt text');
  });

  it('renders strikethrough text (GFM)', () => {
    render(<MarkdownRenderer content="This is ~~deleted~~ text." />);

    const deletedText = screen.getByText('deleted');
    expect(deletedText.tagName.toLowerCase()).toBe('del');
  });

  it('renders task lists (GFM)', () => {
    render(<MarkdownRenderer content={`- [x] Done
- [ ] Todo`} />);

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
  });

  it('applies custom className', () => {
    const { container } = render(
      <MarkdownRenderer content="Test" className="custom-class" />
    );

    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('custom-class');
    expect(wrapper).toHaveClass('prose');
  });

  it('applies prose styling', () => {
    const { container } = render(<MarkdownRenderer content="Test" />);

    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('prose');
    expect(wrapper).toHaveClass('prose-sm');
  });

  it('handles empty content', () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.firstChild).toBeEmptyDOMElement();
  });

  it('renders nested lists', () => {
    const content = `
- Parent 1
  - Child 1
  - Child 2
- Parent 2
`;
    render(<MarkdownRenderer content={content} />);

    const lists = document.querySelectorAll('ul');
    expect(lists.length).toBeGreaterThanOrEqual(2); // Parent and nested list
  });
});
