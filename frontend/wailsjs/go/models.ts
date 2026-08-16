export namespace search {
	
	export class Hit {
	    id: string;
	    title: string;
	    kind: string;
	    snip: string;
	    score: number;
	
	    static createFrom(source: any = {}) {
	        return new Hit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.kind = source["kind"];
	        this.snip = source["snip"];
	        this.score = source["score"];
	    }
	}

}

export namespace store {
	
	export class SaveResult {
	    rev: number;
	    conflict: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SaveResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rev = source["rev"];
	        this.conflict = source["conflict"];
	    }
	}
	export class Scenario {
	    id: string;
	    title: string;
	    system: string;
	    players: string;
	    playTime: string;
	    meta: string;
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new Scenario(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.system = source["system"];
	        this.players = source["players"];
	        this.playTime = source["playTime"];
	        this.meta = source["meta"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class Section {
	    id: string;
	    scenarioId: string;
	    parentId: string;
	    kind: string;
	    title: string;
	    body: string;
	    sortKey: string;
	    rev: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new Section(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.scenarioId = source["scenarioId"];
	        this.parentId = source["parentId"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.body = source["body"];
	        this.sortKey = source["sortKey"];
	        this.rev = source["rev"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class SectionMeta {
	    id: string;
	    scenarioId: string;
	    parentId: string;
	    kind: string;
	    title: string;
	    sortKey: string;
	    rev: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new SectionMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.scenarioId = source["scenarioId"];
	        this.parentId = source["parentId"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.sortKey = source["sortKey"];
	        this.rev = source["rev"];
	        this.updatedAt = source["updatedAt"];
	    }
	}

}

