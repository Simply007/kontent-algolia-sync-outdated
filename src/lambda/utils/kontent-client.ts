import { ContentItem, GenericElement, DeliveryClient, ItemMapper } from '@kentico/kontent-delivery'
import { KontentConfiguration, SearchableItem, ContentBlock } from "./search-model";

class KontentClient {
  config: KontentConfiguration;
  deliveryClient: DeliveryClient;

  constructor(config: KontentConfiguration) {
    this.config = config;
    this.deliveryClient = new DeliveryClient({ projectId: this.config.projectId });
  }

  // PRIVATE: processes linked content + components
  _getLinkedContent(codenames: string[], parents: string[], children: string[], allContent: ContentItem[]) {
    const linkedContent: ContentBlock[] = [];

    for (let x = 0, linkedCodename: string; (linkedCodename = codenames[x]); x++) {
      const foundLinkedItem: ContentItem | undefined = allContent.find(i => i.system.codename == linkedCodename);
      // IF THE LINKED ITEM CONTAINS SLUG, IT'S NOT BEING INCLUDED IN THE PARENT'S CONTENT

      if (foundLinkedItem) {
        children.push(foundLinkedItem.system.codename);
        if (!foundLinkedItem[this.config.slugCodename]) {// if the item doesn't have a slug -> include
          linkedContent.push(...this.getContentFromItem(foundLinkedItem, parents, children, allContent));
        }
      }
    }

    return linkedContent;
  }

  // returns all content, including linked items in one flat array of ContentItems
  async getAllContentFromProject(): Promise<ContentItem[]> {
    if (!this.config.language) return [];
    const feed = await this.deliveryClient.itemsFeedAll().languageParameter(this.config.language).toPromise();

    const linkedItemArray = [];
    for (let prop in feed.linkedItems)
      linkedItemArray.push(feed.linkedItems[prop]);

    // all content items (including modular content) + components put into one array
    return [...feed.items, ...linkedItemArray];
  }

  async getAllContentForCodename(codename: string): Promise<ContentItem[]> {
    if (!this.config.language) return [];
    try {
      const content = await this.deliveryClient.item(codename)
        .languageParameter(this.config.language).depthParameter(100).toPromise();

      const linkedItemArray = [];
      for (let prop in content.linkedItems)
        linkedItemArray.push(content.linkedItems[prop]);

      // all content items (including modular content) + components put into one array
      return [content.item, ...linkedItemArray];
    }
    catch (error) {
      console.error(error);
      return [];
    }
  }

  // extracts text content from an item + linked items
  getContentFromItem(item: ContentItem, parents: string[], children: string[], allContent: ContentItem[]): ContentBlock[] {
    if (!item) return [];

    // array of linked content for this item
    let linkedContent: ContentBlock[] = [];
    const contents: string[] = [];

    // content of the currently processed item
    let itemsContent: ContentBlock = {
      id: item.system.id,
      codename: item.system.codename,
      language: item.system.language,
      collection: item.system.collection,
      type: item.system.type,
      name: item.system.name,
      parents: parents,
      contents: ""
    };

    // go over each element and extract it's contents
    // ONLY FOR TEXT/RICH-TEXT + LINKED ITEMS (modular content)
    for (let propName in item._raw.elements) {
      const property: GenericElement = item[propName];
      const type: string = property.type;
      let stringValue: string = "";

      switch (type) {
        case "text": // for text property -> copy the value
          stringValue = property.value;
          if (stringValue)
            contents.push(stringValue);
          break;
        case "rich_text": // for rich text -> strip HTML and copy the value
          stringValue = property.value.replace(/<[^>]*>?/gm, '');
          if (stringValue)
            contents.push(stringValue)
          // for rich text -> process linked content + components
          if (property.linkedItemCodenames && property.linkedItemCodenames.length > 0)
            linkedContent = [...linkedContent, ...this._getLinkedContent(property.linkedItemCodenames, [item.system.codename, ...parents], children, allContent)];
          break;
        case "modular_content": // for modular content -> process modular content
          if (property.itemCodenames && property.itemCodenames.length > 0)
            linkedContent = [...linkedContent, ...this._getLinkedContent(property.itemCodenames, [item.system.codename, ...parents], children, allContent)];
          break;
        //@TODO: case "custom_element": ... (searchable value)
      }
    }

    itemsContent.contents = contents.join(" ").replace('"', ''); // create one long string from contents
    return [itemsContent, ...linkedContent];
  }

  // creates a searchable structure (i.e. how the content should be structured for search) from obtained content
  createSearchableStructure(contentWithSlug: ContentItem[], allContent: ContentItem[]): SearchableItem[] {
    const searchableStructure: SearchableItem[] = [];

    // process all items with slug into searchable items
    for (let x = 0, item: ContentItem; (item = contentWithSlug[x]); x++) {
      // searchable item structure
      let searchableItem: SearchableItem = {
        objectID: item.system.codename,
        id: item.system.id,
        codename: item.system.codename,
        name: item.system.name,
        language: item.system.language,
        type: item.system.type,
        collection: item.system.collection,
        slug: item[this.config.slugCodename].value,
        parents: [],
        children: [],
        content: []
      };

      searchableItem.content = this.getContentFromItem(item, searchableItem.parents, searchableItem.children, allContent,);
      searchableStructure.push(searchableItem);
    }

    // fill out parents for all "slug" items as well
    for (let i = 0, searchableItem: SearchableItem; (searchableItem = searchableStructure[i]); i++) {
      searchableItem.parents = searchableStructure.filter(i => i.children.includes(searchableItem.codename)).map(i => i.codename);
    }

    return searchableStructure;
  }
}

export default KontentClient;