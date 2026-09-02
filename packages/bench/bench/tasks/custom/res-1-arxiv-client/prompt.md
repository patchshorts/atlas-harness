Implement fetch_recent(category, max_results) in arxiv_client.py against the
CURRENT arXiv API. The doc comment in the file describes the deprecated v1
format — verify the live API with your research tools before implementing:
endpoint path, query parameters (category + pagination), and the Atom XML
fields used for id, title, authors, and published date. Requirements:
1. dict keys exactly: id, title, authors (list of str), published (str).
2. Multiple <author> entries per paper are supported.
3. Entries missing optional fields do not crash.
4. source=<path> parses a saved response file (used by tests); source=None hits
   the live API. Do not change the signature.
