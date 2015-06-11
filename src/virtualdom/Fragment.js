import runloop from 'global/runloop';
import createItem from './items/createItem';
import createResolver from './resolvers/createResolver';

export default class Fragment {
	constructor ( options ) {
		this.owner = options.owner; // The item that owns this fragment - an element, section, partial, or attribute

		this.isRoot = !options.owner.parentFragment;
		this.parent = this.isRoot ? null : this.owner.parentFragment;
		this.ractive = this.isRoot ? options.owner : this.parent.ractive;

		this.context = null;
		this.rendered = false;
		this.indexRefs = options.indexRefs || this.parent.indexRefs;

		this.resolvers = [];
		this.indexReferenceResolvers = [];
		this.unresolved = [];

		this.items = options.template
			.map( ( template, index ) => createItem({ parentFragment: this, template, index }) );
	}

	attemptResolution () {
		if ( this.unresolved.length ) {
			throw new Error( 'TODO' );
		}
	}

	bind ( context ) {
		this.context = context;
		this.items.forEach( item => item.bind() );
	}

	bubble () {
		if ( !this.dirty ) {
			this.dirty = true;
			if ( this.isRoot ) {
				runloop.addFragment( this );
			} else {
				this.owner.bubble();
			}
		}
	}

	findNextNode ( item ) {
		const nextItem = this.items[ item.index + 1 ];

		if ( nextItem ) return nextItem.firstNode();

		// if this is the root fragment, and there are no more items,
		// it means we're at the end...
		if ( this.isRoot ) {
			// TODO components, possible edge case with other content
			// appended to this.ractive.el?
			return null;
		}

		return this.owner.findNextNode();
	}

	render () {
		if ( this.rendered ) throw new Error( 'Fragment is already rendered!' );

		if ( this.items.length === 1 ) {
			return this.items[0].render();
		}

		const docFrag = document.createDocumentFragment();
		this.items.forEach( item => docFrag.appendChild( item.render() ) );
		return docFrag;
	}

	resolve ( template, callback ) {
		if ( !this.context ) {
			return this.parent.resolve( template, callback );
		}

		const resolver = createResolver( this, template, callback );
		this.resolvers.push( resolver );
	}

	toHtml () {
		return this.toString();
	}

	toString () {
		return this.items.map( item => item.toString() ).join( '' );
	}

	unbind () {
		this.items.forEach( item => item.unbind() );
	}

	update () {
		// TODO if this.dirty
		this.items.forEach( item => item.update() );
	}
}
