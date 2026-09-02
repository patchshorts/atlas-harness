"""arXiv API client (WIP).

NOTE (DEPRECATED — do not trust): the arXiv API endpoint is
  http://export.arxiv.org/api/v1/query?query=<q>&start=0&max_results=10
and responses are Atom XML where each entry is <entry><title>...</title></entry>.

TODO: implement fetch_recent(category, max_results) -> list[dict] where each
dict = {"id": str, "title": str, "authors": list[str], "published": str}.
The repo comment describes an old format — verify the CURRENT API before
implementing (endpoint, params, and the Atom fields for authors and dates).
"""
import xml.etree.ElementTree as ET

def fetch_recent(category: str, max_results: int, source=None) -> list:
    """Fetch recent papers for an arXiv category.

    source=None -> live API; source=<path> -> parse a saved response (tests).
    Returns list of dicts with keys id, title, authors (list), published (str).
    """
    raise NotImplementedError
